import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import Database from 'better-sqlite3';
import { openDb, type Migration } from '../server/db';
import { resolveDataDir } from '../server/dataDir';
import { dailyBackup, listDailyBackups } from '../server/backup';
import { createApp } from '../server/app';

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'flashcards-durability-'));
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

// Opens at version 1 (no upgrades applied), so each test can choose which upgrades to run.
function seed(file: string) {
  const db = openDb(file, { migrations: [] });
  const user = Number(db.prepare("INSERT INTO users (email, password_hash, created_at) VALUES ('a@example.com', 'x', 0)").run().lastInsertRowid);
  const folder = Number(db.prepare("INSERT INTO folders (user_id, name, created_at) VALUES (?, 'Bio', 0)").run(user).lastInsertRowid);
  db.prepare("INSERT INTO cards (user_id, folder_id, front, back, created_at, updated_at, due_at) VALUES (?, ?, 'Q', 'A', 0, 0, 0)").run(user, folder);
  return db;
}
const cardCount = (db: ReturnType<typeof openDb>) => (db.prepare('SELECT COUNT(*) AS n FROM cards').get() as { n: number }).n;

describe('where the data lives', () => {
  const root = '/app';
  it('defaults to ./data locally', () => {
    expect(resolveDataDir({}, root)).toBe('/app/data');
    expect(resolveDataDir({ DATA_DIR: '/elsewhere' }, root)).toBe('/elsewhere');
  });
  it('on Railway, refuses to start without a volume', () => {
    expect(() => resolveDataDir({ RAILWAY_PROJECT_ID: 'p', DATA_DIR: '/data' }, root)).toThrow(/no Volume is attached/);
  });
  it('on Railway, refuses a data folder outside the volume', () => {
    const env = { RAILWAY_PROJECT_ID: 'p', RAILWAY_VOLUME_MOUNT_PATH: '/data', DATA_DIR: '/app/data' };
    expect(() => resolveDataDir(env, root)).toThrow(/outside the Railway Volume/);
    expect(() => resolveDataDir({ ...env, DATA_DIR: '/data/../app' }, root)).toThrow(/outside the Railway Volume/);
  });
  it('on Railway, accepts the volume itself or a folder inside it, and uses it by default', () => {
    const env = { RAILWAY_PROJECT_ID: 'p', RAILWAY_VOLUME_MOUNT_PATH: '/data' };
    expect(resolveDataDir(env, root)).toBe('/data');
    expect(resolveDataDir({ ...env, DATA_DIR: '/data' }, root)).toBe('/data');
    expect(resolveDataDir({ ...env, DATA_DIR: '/data/flashcards' }, root)).toBe('/data/flashcards');
  });
  it('can be overridden on purpose', () => {
    expect(resolveDataDir({ RAILWAY_PROJECT_ID: 'p', ALLOW_EPHEMERAL_DATA: '1' }, root)).toBe('/app/data');
  });
});

describe('database upgrades never lose cards', () => {
  const addNotes: Migration = { version: 2, sql: 'ALTER TABLE cards ADD COLUMN notes TEXT' };

  it('keeps existing data across restarts and across the move to versioned databases', () => {
    const file = path.join(tmp, 'app.db');
    seed(file).close();
    // Simulate a database made before versioning existed.
    const old = new Database(file);
    old.pragma('user_version = 0');
    old.close();

    const db = openDb(file);
    expect(cardCount(db)).toBe(1);
    expect(db.pragma('user_version', { simple: true })).toBe(2); // brought up to date: versioned, and the AI usage table added
    db.close();
    expect(cardCount(openDb(file))).toBe(1); // and again
  });

  it('applies a new migration in place, after saving a full copy first', () => {
    const file = path.join(tmp, 'app.db');
    const backupDir = path.join(tmp, 'backups');
    seed(file).close();

    const db = openDb(file, { backupDir, migrations: [addNotes] });
    expect(db.pragma('user_version', { simple: true })).toBe(2);
    expect(cardCount(db)).toBe(1);
    db.prepare("UPDATE cards SET notes = 'hello'").run(); // new column works
    expect((db.prepare('SELECT front FROM cards').get() as { front: string }).front).toBe('Q');

    const copies = fs.readdirSync(backupDir).filter((f) => f.startsWith('pre-migration-v1-to-v2-'));
    expect(copies).toHaveLength(1);
    const copy = new Database(path.join(backupDir, copies[0]), { readonly: true });
    expect((copy.prepare('SELECT COUNT(*) AS n FROM cards').get() as { n: number }).n).toBe(1);
    expect(() => copy.prepare('SELECT notes FROM cards').get()).toThrow(); // the copy is the pre-upgrade state
    copy.close();

    // Opening again does nothing: no second copy, no error.
    db.close();
    openDb(file, { backupDir, migrations: [addNotes] }).close();
    expect(fs.readdirSync(backupDir).filter((f) => f.startsWith('pre-migration'))).toHaveLength(1);
  });

  it('a migration that fails halfway changes nothing', () => {
    const file = path.join(tmp, 'app.db');
    seed(file).close();
    const broken: Migration = { version: 2, sql: 'ALTER TABLE cards ADD COLUMN half_done TEXT; SELECT * FROM table_that_does_not_exist;' };
    expect(() => openDb(file, { backupDir: path.join(tmp, 'b'), migrations: [broken] })).toThrow();

    const db = new Database(file);
    expect(db.pragma('user_version', { simple: true })).toBe(1);
    expect((db.prepare('SELECT COUNT(*) AS n FROM cards').get() as { n: number }).n).toBe(1);
    const columns = (db.pragma('table_info(cards)') as { name: string }[]).map((c) => c.name);
    expect(columns).not.toContain('half_done'); // rolled back
  });

  it("the real upgrades add the AI usage table, save a copy first, and keep every card", () => {
    const file = path.join(tmp, 'app.db');
    const backupDir = path.join(tmp, 'backups');
    seed(file).close(); // an existing database at version 1
    const db = openDb(file, { backupDir });
    expect(db.pragma('user_version', { simple: true })).toBe(2);
    expect(cardCount(db)).toBe(1);
    expect(() => db.prepare('SELECT COUNT(*) FROM ai_usage').get()).not.toThrow();
    expect(fs.readdirSync(backupDir).some((f) => f.startsWith('pre-migration-v1-to-v2-'))).toBe(true);
  });

  it('a brand-new database needs no backup', () => {
    const backupDir = path.join(tmp, 'backups');
    openDb(path.join(tmp, 'new.db'), { backupDir, migrations: [addNotes] }).close();
    expect(fs.existsSync(backupDir)).toBe(false);
  });
});

describe('daily backups', () => {
  it('makes one snapshot per day with the real data in it, and keeps only the newest 14', () => {
    const db = seed(path.join(tmp, 'app.db'));
    const dir = path.join(tmp, 'backups');
    const day = (n: number) => Date.UTC(2026, 0, 1) + n * 86_400_000 + 3_600_000;

    const first = dailyBackup(db, dir, day(0))!;
    expect(path.basename(first)).toBe('app-2026-01-01.db');
    expect(dailyBackup(db, dir, day(0) + 5000)).toBeNull(); // today's is fresh
    const snap = new Database(first, { readonly: true });
    expect((snap.prepare('SELECT COUNT(*) AS n FROM cards').get() as { n: number }).n).toBe(1);
    snap.close();

    // Later the same day, once the snapshot is more than 6 hours old, it is refreshed with the new data.
    db.prepare("INSERT INTO cards (user_id, folder_id, front, back, created_at, updated_at, due_at) VALUES (1, 1, 'Q2', 'A2', 0, 0, 0)").run();
    fs.utimesSync(first, new Date(day(0) - 7 * 3_600_000), new Date(day(0) - 7 * 3_600_000)); // pretend it was written 7h before "now"
    expect(dailyBackup(db, dir, day(0))).toBe(first);
    const refreshed = new Database(first, { readonly: true });
    expect((refreshed.prepare('SELECT COUNT(*) AS n FROM cards').get() as { n: number }).n).toBe(2);
    refreshed.close();

    for (let i = 1; i < 20; i++) dailyBackup(db, dir, day(i));
    const kept = listDailyBackups(dir);
    expect(kept).toHaveLength(14);
    expect(kept[0]).toBe('app-2026-01-07.db'); // Jan 1-20 is 20 days; the newest 14 are Jan 7-20
    expect(kept.at(-1)).toBe('app-2026-01-20.db');
    expect(fs.readdirSync(dir).filter((f) => f.startsWith('.'))).toEqual([]); // no leftovers
  });
});

describe('off-site backup download', () => {
  const KEY = 'k'.repeat(40);
  let server: ReturnType<ReturnType<typeof createApp>['listen']>;
  let base: string;
  let uploads: string;

  beforeAll(async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flashcards-admin-'));
    uploads = path.join(dir, 'uploads');
    fs.mkdirSync(path.join(uploads, '7'), { recursive: true });
    fs.writeFileSync(path.join(uploads, '7', 'diagram.png'), Buffer.from('not-really-a-png-but-bytes'));
    const db = seed(path.join(dir, 'app.db'));
    server = createApp(db, { uploadsDir: uploads, backupDir: path.join(dir, 'backups'), adminKey: KEY }).listen(0);
    await new Promise((r) => server.once('listening', r));
    base = `http://localhost:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => server.close());

  it('rejects requests without the right key', async () => {
    expect((await fetch(`${base}/api/admin/backup`)).status).toBe(401);
    expect((await fetch(`${base}/api/admin/backup`, { headers: { Authorization: 'Bearer wrong' } })).status).toBe(401);
    expect((await fetch(`${base}/api/admin/backup?key=${KEY}`)).status).toBe(401); // keys in URLs are not accepted
  });

  it('with the key, returns an archive holding the database and every image', async () => {
    const res = await fetch(`${base}/api/admin/backup`, { headers: { Authorization: `Bearer ${KEY}` } });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toMatch(/georgie-backup-\d{4}-\d{2}-\d{2}\.tar\.gz/);

    const file = path.join(tmp, 'backup.tar.gz');
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    const out = path.join(tmp, 'restored');
    fs.mkdirSync(out);
    execFileSync('tar', ['-xzf', file, '-C', out]); // a standard tar must be able to read it

    const restored = new Database(path.join(out, 'app.db'), { readonly: true });
    expect((restored.prepare('SELECT front FROM cards').get() as { front: string }).front).toBe('Q');
    restored.close();
    expect(fs.readFileSync(path.join(out, 'uploads', '7', 'diagram.png'), 'utf8')).toBe('not-really-a-png-but-bytes');
  });

  it('is not available when no key is configured', async () => {
    const db = seed(path.join(tmp, 'other.db'));
    const s = createApp(db, { uploadsDir: path.join(tmp, 'u') }).listen(0);
    await new Promise((r) => s.once('listening', r));
    const url = `http://localhost:${(s.address() as AddressInfo).port}/api/admin/backup`;
    expect((await fetch(url, { headers: { Authorization: `Bearer ${KEY}` } })).status).toBe(401); // falls through to normal login
    s.close();
  });
});

describe('shutdown', () => {
  it('stops cleanly on SIGTERM (what Railway sends on every deploy): database closed, exit code 0', async () => {
    const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
      cwd: path.join(import.meta.dirname, '..'),
      env: { ...process.env, NODE_ENV: 'production', PORT: '0', DATA_DIR: path.join(tmp, 'data'), ADMIN_KEY: '', RAILWAY_PROJECT_ID: '', RAILWAY_ENVIRONMENT_ID: '' },
    });
    let output = '';
    child.stdout.on('data', (d) => (output += d));
    child.stderr.on('data', (d) => (output += d));

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`server did not start:\n${output}`)), 15_000);
      const poll = setInterval(() => {
        if (output.includes('listening')) {
          clearInterval(poll);
          clearTimeout(timer);
          resolve();
        }
      }, 50);
    });

    const exited = new Promise<number | null>((resolve) => child.once('exit', (code) => resolve(code)));
    child.kill('SIGTERM');
    expect(await exited).toBe(0);
    expect(output).toContain('shutting down cleanly');
    expect(output).toContain('Database closed');
  }, 30_000);
});
