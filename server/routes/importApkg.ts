import { Router } from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { DB } from '../db';
import { HttpError, parse } from '../http';
import { buildApkgItems, defaultMappings, readApkg, type ApkgPackage } from '../apkg';
import { commitImport, dryRunImport } from '../importer';
import { optionsSchema } from '../importSchemas';
import { sampleIndexes } from '../../shared/importParse';

const MAX_UPLOAD = 50 * 1024 * 1024;
const MAX_STAGED_PER_USER = 3;
const KEEP_FOR_MS = 30 * 60 * 1000;
const MAX_INLINE_IMAGE = 2 * 1024 * 1024;

const mappingsSchema = z.record(z.string().max(40), z.object({ front: z.number().int().min(0).max(200), back: z.number().int().min(0).max(200).nullable() }));
const settingsSchema = z.object({ token: z.string().max(100), mappings: mappingsSchema, stripCommonRoot: z.boolean() });

interface Staged {
  userId: number;
  file: string;
  fileName: string;
  expires: number;
}

/**
 * Importing an Anki .apkg takes two steps, because you review it before anything is saved:
 *   1. upload  -> we keep the file in a temporary folder and describe what's in it (note types, decks, pictures)
 *   2. preview / dry-run / commit, each naming that upload by a secret token, plus the user's choices.
 */
export function apkgRouter(db: DB, opts: { uploadsDir: string; stagingDir: string }) {
  const router = Router();
  fs.mkdirSync(opts.stagingDir, { recursive: true });
  for (const f of fs.readdirSync(opts.stagingDir)) fs.rmSync(path.join(opts.stagingDir, f), { force: true }); // leftovers from a restart

  const staged = new Map<string, Staged>();
  const parsed = new Map<string, ApkgPackage>(); // the last couple of decks we parsed, so tweaking a setting is instant

  const forget = (token: string) => {
    const s = staged.get(token);
    if (s) fs.rmSync(s.file, { force: true });
    staged.delete(token);
    parsed.delete(token);
  };
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [token, s] of staged) if (s.expires < now) forget(token);
  }, 10 * 60 * 1000);
  sweep.unref();

  const upload = multer({
    storage: multer.diskStorage({ destination: opts.stagingDir, filename: (_req, _file, cb) => cb(null, `${crypto.randomUUID()}.apkg`) }),
    limits: { fileSize: MAX_UPLOAD, files: 1 },
  }).single('file');

  const stageOf = (userId: number, token: string): Staged => {
    const s = staged.get(token);
    if (!s || s.userId !== userId || s.expires < Date.now()) throw new HttpError(404, 'That upload has expired. Please choose the file again.');
    return s;
  };

  const packageOf = (userId: number, token: string): ApkgPackage => {
    const s = stageOf(userId, token);
    let pkg = parsed.get(token);
    if (!pkg) {
      pkg = readApkg(fs.readFileSync(s.file));
      parsed.set(token, pkg);
      while (parsed.size > 2) parsed.delete(parsed.keys().next().value!);
    }
    return pkg;
  };

  router.post('/analyze', (req, res, next) => {
    upload(req, res, (err) => {
      try {
        if (err) {
          if ((err as { code?: string }).code === 'LIMIT_FILE_SIZE') throw new HttpError(413, 'That file is larger than 50 MB, which is more than Georgie can import in one go.');
          throw err;
        }
        if (!req.file) throw new HttpError(400, 'No file was uploaded');
        const user = req.user!;
        let pkg: ApkgPackage;
        try {
          pkg = readApkg(fs.readFileSync(req.file.path));
        } catch (e) {
          fs.rmSync(req.file.path, { force: true });
          throw e;
        }
        // Each user may keep a few uploads waiting at once; starting another discards their oldest.
        const mine = [...staged.entries()].filter(([, s]) => s.userId === user.id);
        for (const [oldToken] of mine.slice(0, Math.max(0, mine.length - (MAX_STAGED_PER_USER - 1)))) forget(oldToken);
        const token = crypto.randomBytes(24).toString('hex');
        const fileName = req.file.originalname;
        staged.set(token, { userId: user.id, file: req.file.path, fileName, expires: Date.now() + KEEP_FOR_MS });
        parsed.set(token, pkg);
        while (parsed.size > 2) parsed.delete(parsed.keys().next().value!);
        res.status(201).json({
          token,
          fileName,
          format: pkg.format,
          noteCount: pkg.notes.length,
          mediaCount: pkg.media.size,
          noteTypes: pkg.noteTypes,
          decks: pkg.decks,
          commonRoot: pkg.commonRoot,
          suggestedName: pkg.commonRoot ?? fileName.replace(/\.apkg$/i, '').trim() ?? 'Imported deck',
          mappings: defaultMappings(pkg),
        });
      } catch (e) {
        next(e);
      }
    });
  });

  // Three example cards as they would appear in Georgie, pictures included.
  router.post('/preview', (req, res) => {
    const body = parse(settingsSchema.extend({ shift: z.number().int().min(0).max(1000).optional() }), req.body);
    const pkg = packageOf(req.user!.id, body.token);
    const { items, stats } = buildApkgItems(pkg, body.mappings, { stripCommonRoot: body.stripCommonRoot });
    const inline = (img: { mime: string; data: Buffer }) => (img.data.length <= MAX_INLINE_IMAGE ? `data:${img.mime};base64,${img.data.toString('base64')}` : null);
    const samples = sampleIndexes(items.length, body.shift ?? 0).map((i) => {
      const it = items[i];
      return {
        path: it.path,
        front: it.front,
        back: it.back,
        frontImages: (it.images ?? []).filter((m) => m.side === 'front').map(inline).filter(Boolean),
        backImages: (it.images ?? []).filter((m) => m.side === 'back').map(inline).filter(Boolean),
      };
    });
    res.json({ samples, stats });
  });

  const importSettings = settingsSchema.extend({ options: optionsSchema });

  router.post('/dry-run', (req, res) => {
    const body = parse(importSettings, req.body);
    const { items, stats } = buildApkgItems(packageOf(req.user!.id, body.token), body.mappings, { stripCommonRoot: body.stripCommonRoot });
    res.json({ ...dryRunImport(db, req.user!.id, items, body.options), stats });
  });

  router.post('/commit', (req, res) => {
    const body = parse(importSettings, req.body);
    const { items, stats } = buildApkgItems(packageOf(req.user!.id, body.token), body.mappings, { stripCommonRoot: body.stripCommonRoot });
    const summary = commitImport(db, req.user!, items, { ...body.options, uploadsDir: opts.uploadsDir });
    forget(body.token);
    res.status(201).json({ ...summary, stats });
  });

  return router;
}
