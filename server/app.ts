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

export interface AppOptions {
  uploadsDir: string;
  /** Built client to serve (production only). */
  clientDir?: string;
  secureCookies?: boolean;
}

export function createApp(db: DB, opts: AppOptions) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  app.use('/api/auth', authRouter(db, { secureCookies: !!opts.secureCookies }));

  const api = express.Router();
  api.use(requireAuth(db));
  api.use('/folders', folderRouter(db, opts.uploadsDir));
  api.use(cardRouter(db, opts.uploadsDir));
  api.use(imageRouter(db, opts.uploadsDir));
  api.use(studyRouter(db));
  api.use(exportRouter(db));
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
