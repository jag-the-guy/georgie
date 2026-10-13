import { Router, type Request } from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream';
import { snapshotDb, type DB } from '../db';
import { createArchive, entriesUnder } from '../archive';
import { HttpError } from '../http';

export const MIN_ADMIN_KEY_LENGTH = 24;

const digest = (s: string) => crypto.createHash('sha256').update(s).digest();

function hasValidKey(req: Request, adminKey: string): boolean {
  const match = /^Bearer (.+)$/.exec(req.get('authorization') ?? '');
  return match !== null && crypto.timingSafeEqual(digest(match[1]), digest(adminKey));
}

/**
 * Owner-only routes, protected by the ADMIN_KEY environment variable (not by a user login).
 *   curl -H "Authorization: Bearer <ADMIN_KEY>" https://your-site/api/admin/backup -o backup.tar.gz
 */
export function adminRouter(db: DB, opts: { adminKey: string; uploadsDir: string; backupDir: string }) {
  const router = Router();

  router.use((req, _res, next) => {
    if (!hasValidKey(req, opts.adminKey)) throw new HttpError(401, 'Invalid or missing admin key');
    next();
  });

  // A full backup: a consistent copy of the database plus every uploaded image.
  router.get('/backup', (_req, res, next) => {
    const tmp = path.join(opts.backupDir, `.download-${crypto.randomUUID()}.db`);
    try {
      snapshotDb(db, tmp);
    } catch (err) {
      next(err);
      return;
    }
    const archive = createArchive([{ name: 'app.db', file: tmp }, ...entriesUnder(opts.uploadsDir, 'uploads')]);
    res.setHeader('Content-Type', 'application/gzip');
    res.setHeader('Content-Disposition', `attachment; filename="georgie-backup-${new Date().toISOString().slice(0, 10)}.tar.gz"`);
    pipeline(archive, res, () => fs.rm(tmp, { force: true }, () => {}));
  });

  return router;
}
