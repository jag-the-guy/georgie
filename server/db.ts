import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

export type DB = Database.Database;

const schema = fs.readFileSync(path.join(import.meta.dirname, 'schema.sql'), 'utf8');

export interface Migration {
  /** Must be greater than every earlier version. Version 1 is schema.sql itself. */
  version: number;
  sql: string;
}

/**
 * HOW TO CHANGE THE DATABASE LATER (e.g. add a column) WITHOUT LOSING ANYONE'S CARDS:
 * never edit an existing table in schema.sql and hope. Instead append a migration here, e.g.
 *   { version: 2, sql: 'ALTER TABLE cards ADD COLUMN notes TEXT' }
 * On the next start each pending migration runs once, inside a transaction (all or nothing),
 * after a full copy of the database is saved to the backups folder.
 */
export const MIGRATIONS: Migration[] = [];

export interface OpenOptions {
  /** Where to save a copy of the database before it is upgraded. */
  backupDir?: string;
  migrations?: Migration[];
}

/** A consistent copy of the live database (safe while the app is running). The destination must not exist. */
export function snapshotDb(db: DB, dest: string) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  db.prepare('VACUUM INTO ?').run(dest);
}

export function openDb(file: string, opts: OpenOptions = {}): DB {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db, file, opts);
  return db;
}

function migrate(db: DB, file: string, { backupDir, migrations = MIGRATIONS }: OpenOptions) {
  let version = db.pragma('user_version', { simple: true }) as number;

  // Version 0 = brand new, or created before versioning existed. schema.sql only uses IF NOT EXISTS,
  // so running it over an existing database changes nothing and just stamps it as version 1.
  if (version < 1) {
    db.exec(schema);
    db.pragma('user_version = 1');
    version = 1;
  }

  const latest = Math.max(1, ...migrations.map((m) => m.version));
  if (version > latest) {
    console.warn(
      `WARNING: the database is at version ${version} but this code only knows up to ${latest}. ` +
        'It was probably upgraded by a newer deploy. Running older code against it may misbehave.',
    );
  }

  const pending = migrations.filter((m) => m.version > version).sort((a, b) => a.version - b.version);
  if (pending.length === 0) return;

  const hasData = (db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n > 0;
  if (backupDir && file !== ':memory:' && hasData) {
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '');
    const dest = path.join(backupDir, `pre-migration-v${version}-to-v${latest}-${stamp}.db`);
    snapshotDb(db, dest);
    console.log(`Saved a copy of the database before upgrading: ${dest}`);
  }

  for (const m of pending) {
    db.transaction(() => {
      db.exec(m.sql);
      db.pragma(`user_version = ${m.version}`);
    })();
    console.log(`Database upgraded to version ${m.version}`);
  }
}

/** Recursive CTE selecting `sub(id)`: the folder and all its descendants, owned by the user. Params: folderId, userId. */
export const SUBTREE_CTE = `
  WITH RECURSIVE sub(id) AS (
    SELECT id FROM folders WHERE id = ? AND user_id = ?
    UNION ALL
    SELECT f.id FROM folders f JOIN sub ON f.parent_id = sub.id
  )`;
