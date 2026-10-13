import fs from 'node:fs';
import path from 'node:path';
import { snapshotDb, type DB } from './db';

const DAILY = /^app-(\d{4}-\d{2}-\d{2})\.db$/;

export function listDailyBackups(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => DAILY.test(f))
    .sort();
}

/**
 * Keeps one snapshot file per UTC day (the newest `keep` days), and refreshes today's file if it is
 * more than `refreshMs` old, so the snapshot is never much more than a few hours behind.
 * Returns the file written, or null if today's is still fresh.
 * These live on the same volume as the database, so they protect against bad deploys, bugs and
 * accidental deletes, but not against losing the volume itself: keep an off-site copy too.
 */
export function dailyBackup(db: DB, dir: string, now = Date.now(), keep = 14, refreshMs = 6 * 60 * 60 * 1000): string | null {
  const name = `app-${new Date(now).toISOString().slice(0, 10)}.db`;
  const dest = path.join(dir, name);
  if (fs.existsSync(dest) && now - fs.statSync(dest).mtimeMs < refreshMs) return null;

  const tmp = path.join(dir, `.${name}.partial`);
  fs.rmSync(tmp, { force: true });
  snapshotDb(db, tmp);
  fs.renameSync(tmp, dest); // only ever a complete file under the real name (replaces the older snapshot of today)

  const all = listDailyBackups(dir);
  for (const old of all.slice(0, Math.max(0, all.length - keep))) fs.rmSync(path.join(dir, old), { force: true });
  return dest;
}

/** Takes a snapshot now (if today's is missing or stale), then re-checks every hour. */
export function startBackupSchedule(db: DB, dir: string) {
  const run = () => {
    try {
      const made = dailyBackup(db, dir);
      if (made) console.log(`Daily backup saved: ${made}`);
    } catch (err) {
      console.error('Daily backup FAILED:', err);
    }
  };
  run();
  const timer = setInterval(run, 60 * 60 * 1000);
  timer.unref();
  return () => clearInterval(timer);
}
