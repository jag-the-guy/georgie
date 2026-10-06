import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

export type DB = Database.Database;

const schema = fs.readFileSync(path.join(import.meta.dirname, 'schema.sql'), 'utf8');

export function openDb(file: string): DB {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(schema);
  return db;
}

/** Recursive CTE selecting `sub(id)`: the folder and all its descendants, owned by the user. Params: folderId, userId. */
export const SUBTREE_CTE = `
  WITH RECURSIVE sub(id) AS (
    SELECT id FROM folders WHERE id = ? AND user_id = ?
    UNION ALL
    SELECT f.id FROM folders f JOIN sub ON f.parent_id = sub.id
  )`;
