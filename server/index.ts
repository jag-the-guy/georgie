import path from 'node:path';
import { openDb } from './db';
import { createApp } from './app';
import { resolveDataDir } from './dataDir';
import { startBackupSchedule, listDailyBackups } from './backup';
import { MIN_ADMIN_KEY_LENGTH } from './routes/admin';

const root = path.join(import.meta.dirname, '..');
const production = process.env.NODE_ENV === 'production';
// In dev the API always uses 3001 (Vite proxies to it); PORT only applies to the production server.
const port = production ? Number(process.env.PORT ?? 3000) : 3001;

let dataDir: string;
try {
  dataDir = resolveDataDir(process.env, root);
} catch (err) {
  console.error(`\n${(err as Error).message}\n`);
  process.exit(1);
}
const backupDir = path.join(dataDir, 'backups');
const onHost = Boolean(process.env.RAILWAY_PROJECT_ID || process.env.RAILWAY_ENVIRONMENT_ID);

const db = openDb(path.join(dataDir, 'app.db'), { backupDir });

const count = (table: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
// Shown in the logs on every start, so you can see at a glance that data survived a redeploy.
console.log(
  `Data folder: ${dataDir}\n` +
    `Loaded ${count('users')} accounts, ${count('folders')} folders, ${count('cards')} cards, ${count('card_images')} images. ` +
    `Newest daily backup: ${listDailyBackups(backupDir).at(-1) ?? 'none yet'}`,
);

let adminKey = process.env.ADMIN_KEY;
if (adminKey && adminKey.length < MIN_ADMIN_KEY_LENGTH) {
  console.warn(`ADMIN_KEY is shorter than ${MIN_ADMIN_KEY_LENGTH} characters, so the backup download is switched OFF. Use a longer random key.`);
  adminKey = undefined;
}
if (production && !adminKey) console.warn('ADMIN_KEY is not set: the off-site backup download is switched off.');

startBackupSchedule(db, backupDir);

const app = createApp(db, {
  uploadsDir: path.join(dataDir, 'uploads'),
  backupDir,
  adminKey,
  trustProxy: onHost || process.env.TRUST_PROXY === '1',
  clientDir: production ? path.join(root, 'dist') : undefined,
  secureCookies: process.env.SECURE_COOKIES === '1',
});

app.listen(port, () => {
  console.log(`Georgie Flashcards listening on port ${port}`);
});
