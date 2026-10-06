import path from 'node:path';
import { openDb } from './db';
import { createApp } from './app';

const root = path.join(import.meta.dirname, '..');
const dataDir = process.env.DATA_DIR ?? path.join(root, 'data');
const production = process.env.NODE_ENV === 'production';
// In dev the API always uses 3001 (Vite proxies to it); PORT only applies to the production server.
const port = production ? Number(process.env.PORT ?? 3000) : 3001;

const db = openDb(path.join(dataDir, 'app.db'));
const app = createApp(db, {
  uploadsDir: path.join(dataDir, 'uploads'),
  clientDir: production ? path.join(root, 'dist') : undefined,
  secureCookies: process.env.SECURE_COOKIES === '1',
});

app.listen(port, () => {
  console.log(`Georgie Flashcards API listening on http://localhost:${port}`);
});
