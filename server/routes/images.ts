import { Router } from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { DB } from '../db';
import { HttpError, idParam, parse } from '../http';
import { loadCard, unlinkImageFiles } from '../cards';

const EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

export function imageRouter(db: DB, uploadsDir: string) {
  const router = Router();

  const upload = multer({
    storage: multer.diskStorage({
      destination: (req, _file, cb) => {
        const dir = path.join(uploadsDir, String(req.user!.id));
        fs.mkdir(dir, { recursive: true }, (err) => cb(err, dir));
      },
      filename: (_req, file, cb) => cb(null, `${crypto.randomUUID()}.${EXTENSIONS[file.mimetype]}`),
    }),
    limits: { fileSize: 10 * 1024 * 1024, files: 10 },
    fileFilter: (_req, file, cb) => {
      if (EXTENSIONS[file.mimetype]) cb(null, true);
      else cb(new HttpError(400, 'Only PNG, JPEG, GIF and WebP images are supported'));
    },
  });

  router.post(
    '/cards/:id/images',
    // Check ownership before multer writes anything to disk.
    (req, _res, next) => {
      const id = parse(idParam, req.params.id);
      if (!loadCard(db, req.user!.id, id)) throw new HttpError(404, 'Card not found');
      next();
    },
    upload.array('images', 10),
    (req, res) => {
      const user = req.user!;
      const cardId = parse(idParam, req.params.id);
      const files = (req.files as Express.Multer.File[] | undefined) ?? [];
      const side = parse(z.enum(['front', 'back']), req.body.side ?? 'front');
      if (files.length === 0) throw new HttpError(400, 'No image was uploaded');
      const insert = db.prepare(
        'INSERT INTO card_images (card_id, user_id, side, filename, mime, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      );
      const now = Date.now();
      db.transaction(() => {
        for (const f of files) insert.run(cardId, user.id, side, f.filename, f.mimetype, now);
        db.prepare('UPDATE cards SET updated_at = ? WHERE id = ?').run(now, cardId);
      })();
      res.status(201).json({ card: loadCard(db, user.id, cardId) });
    },
  );

  router.get('/images/:id', (req, res) => {
    const user = req.user!;
    const id = parse(idParam, req.params.id);
    const row = db.prepare('SELECT filename, mime FROM card_images WHERE id = ? AND user_id = ?').get(id, user.id) as
      | { filename: string; mime: string }
      | undefined;
    if (!row) throw new HttpError(404, 'Image not found');
    res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.type(row.mime);
    res.sendFile(path.join(uploadsDir, String(user.id), row.filename));
  });

  router.delete('/images/:id', (req, res) => {
    const user = req.user!;
    const id = parse(idParam, req.params.id);
    const row = db.prepare('SELECT card_id, user_id, filename FROM card_images WHERE id = ? AND user_id = ?').get(id, user.id) as
      | { card_id: number; user_id: number; filename: string }
      | undefined;
    if (!row) throw new HttpError(404, 'Image not found');
    db.prepare('DELETE FROM card_images WHERE id = ?').run(id);
    unlinkImageFiles(uploadsDir, [row]);
    res.json({ card: loadCard(db, user.id, row.card_id) });
  });

  return router;
}
