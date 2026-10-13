import express from 'express';
import cookieParser from 'cookie-parser';
import fs from 'node:fs';
import path from 'node:path';
import type { DB } from './db';
import { authRouter, requireAuth } from './auth';
import { errorHandler, HttpError } from './http';
import { folderRouter } from './routes/folders';
import { cardRouter } from './routes/cards';
import { imageRouter } from './routes/images';
import { studyRouter } from './routes/study';
import { exportRouter } from './routes/export';
import { adminRouter } from './routes/admin';
import { importRouter } from './routes/import';
import { notesRouter, type NotesDeps } from './routes/notes';
import { DemoGenerator } from './notes/demo';

export interface AppOptions {
  uploadsDir: string;
  /** Turn notes into flashcards with AI. Left out, the feature is off for everyone. */
  notes?: Omit<NotesDeps, 'db'>;
  /** Temporary home for Anki decks between "upload" and "import". */
  stagingDir?: string;
  /** Where backup snapshots are written. */
  backupDir?: string;
  /** Secret for the owner-only backup download. Leave unset to switch the admin routes off. */
  adminKey?: string;
  /** True when behind a hosting proxy (Railway etc.), so req.ip is the visitor's address, not the proxy's. */
  trustProxy?: boolean;
  /** Built client to serve (production only). */
  clientDir?: string;
  secureCookies?: boolean;
}

export function createApp(db: DB, opts: AppOptions) {
  const app = express();
  app.disable('x-powered-by');
  if (opts.trustProxy) app.set('trust proxy', 1);
  // Everything is limited to 1 MB of JSON, except the import routes, which set their own, larger limit.
  const smallJson = express.json({ limit: '1mb' });
  app.use((req, res, next) => (req.path.startsWith('/api/import') ? next() : smallJson(req, res, next)));
  app.use(cookieParser());

  // For hosting health checks: confirms the process is up and the database answers.
  app.get('/healthz', (_req, res) => {
    db.prepare('SELECT 1').get();
    res.json({ ok: true });
  });

  app.use('/api/auth', authRouter(db, { secureCookies: !!opts.secureCookies }));

  if (opts.adminKey) {
    app.use(
      '/api/admin',
      adminRouter(db, { adminKey: opts.adminKey, uploadsDir: opts.uploadsDir, backupDir: opts.backupDir ?? path.join(opts.uploadsDir, '..', 'backups') }),
    );
  }

  const api = express.Router();
  api.use(requireAuth(db));
  api.use('/folders', folderRouter(db, opts.uploadsDir));
  api.use(cardRouter(db, opts.uploadsDir));
  api.use(imageRouter(db, opts.uploadsDir));
  api.use(studyRouter(db));
  api.use(exportRouter(db));
  api.use('/notes', notesRouter({ db, generator: new DemoGenerator(), allowed: () => false, dailyLimit: 0, ...opts.notes }));
  api.use('/import', importRouter(db, opts.uploadsDir, opts.stagingDir ?? path.join(opts.uploadsDir, '..', 'staging')));
  app.use('/api', api);
  app.use('/api', () => {
    throw new HttpError(404, 'Not found');
  });

  if (opts.clientDir && fs.existsSync(opts.clientDir)) {
    const index = path.join(opts.clientDir, 'index.html');
    app.use(express.static(opts.clientDir));
    app.use((req, res, next) => (req.method === 'GET' ? res.sendFile(index) : next()));
  }

  app.use(errorHandler);
  return app;
}
