import fs from 'node:fs';
import path from 'node:path';
import type { DB } from './db';
import { SUBTREE_CTE } from './db';
import type { Card, CardImage } from '../shared/types';
import { makeConfig, type SrsConfig } from '../shared/srsConfig';
import type { User } from './auth';

export const configFor = (user: User): SrsConfig => makeConfig({ timezone: user.timezone });

const CARD_COLUMNS = `id, folder_id, front, back, created_at, updated_at,
  state, ease, interval_days, due_at, step, lapses, last_reviewed_at`;

/** Loads cards by id (only the user's own), with their images attached, in the order given. */
export function loadCards(db: DB, userId: number, ids: number[]): Card[] {
  if (ids.length === 0) return [];
  const marks = ids.map(() => '?').join(',');
  const rows = db
    .prepare(`SELECT ${CARD_COLUMNS} FROM cards WHERE user_id = ? AND id IN (${marks})`)
    .all(userId, ...ids) as Omit<Card, 'images'>[];
  const images = db
    .prepare(`SELECT id, card_id, side FROM card_images WHERE user_id = ? AND card_id IN (${marks}) ORDER BY id`)
    .all(userId, ...ids) as (CardImage & { card_id: number })[];
  const byId = new Map(rows.map((r) => [r.id, { ...r, images: [] as CardImage[] }]));
  for (const img of images) byId.get(img.card_id)?.images.push({ id: img.id, side: img.side });
  return ids.map((id) => byId.get(id)).filter((c): c is Card => !!c);
}

export function loadCard(db: DB, userId: number, id: number): Card | undefined {
  return loadCards(db, userId, [id])[0];
}

/** Deletes image files from disk. Rows are removed by the caller (or by ON DELETE CASCADE). */
export function unlinkImageFiles(uploadsDir: string, rows: { user_id: number; filename: string }[]) {
  for (const row of rows) {
    fs.rm(path.join(uploadsDir, String(row.user_id), row.filename), { force: true }, () => {});
  }
}

/**
 * Ids of every card in a folder and its subfolders, in reading order: the folder's own cards first,
 * then each subfolder (alphabetical, depth first). Within a folder, oldest card first.
 */
export function subtreeCardIds(db: DB, userId: number, folderId: number): number[] {
  const folders = db.prepare('SELECT id, parent_id, name FROM folders WHERE user_id = ?').all(userId) as {
    id: number;
    parent_id: number | null;
    name: string;
  }[];
  const children = new Map<number, typeof folders>();
  for (const f of folders) if (f.parent_id !== null) children.set(f.parent_id, [...(children.get(f.parent_id) ?? []), f]);
  const order: number[] = [];
  const visit = (id: number) => {
    order.push(id);
    [...(children.get(id) ?? [])].sort((a, b) => a.name.localeCompare(b.name)).forEach((c) => visit(c.id));
  };
  visit(folderId);

  const rows = db
    .prepare(
      `${SUBTREE_CTE} SELECT id, folder_id FROM cards WHERE user_id = ? AND folder_id IN (SELECT id FROM sub) ORDER BY created_at, id`,
    )
    .all(folderId, userId, userId) as { id: number; folder_id: number }[];
  const byFolder = new Map<number, number[]>();
  for (const r of rows) byFolder.set(r.folder_id, [...(byFolder.get(r.folder_id) ?? []), r.id]);
  return order.flatMap((fid) => byFolder.get(fid) ?? []);
}
