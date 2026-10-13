import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { DB } from './db';
import { HttpError } from './http';
import { newCardFields } from '../shared/scheduler';
import { makeConfig } from '../shared/srsConfig';
import { FOLDER_COLORS } from './routes/folders';

export const MAX_IMPORT_CARDS = 20_000;

export interface ImportImage {
  side: 'front' | 'back';
  ext: 'png' | 'jpg' | 'gif' | 'webp';
  mime: string;
  data: Buffer;
}

export interface ImportItem {
  /** Folder path below the destination ([] = the destination itself). */
  path: string[];
  front: string;
  back: string;
  images?: ImportImage[];
}

export type Destination = { type: 'new'; name: string; parentId?: number | null } | { type: 'existing'; folderId: number };

export interface ImportOptions {
  destination: Destination;
  /** Create the items' folder paths under the destination; if false everything goes straight into it. */
  rebuildFolders: boolean;
  skipDuplicates: boolean;
}

export interface ImportSummary {
  /** Cards that would be / were added. */
  imported: number;
  /** Cards left out because the same front and back already exist in that folder (or earlier in the file). */
  duplicates: number;
  /** Items with nothing in the front, back or pictures. */
  empty: number;
  foldersCreated: number;
  /** Names of folders that would be / were created, parents first. */
  newFolderPaths: string[];
  images: number;
  /** The destination folder (undefined for a dry run into a not-yet-created folder). */
  folderId?: number;
}

interface Node {
  id: number | null; // null = does not exist yet
  name: string;
  parent: Node | null;
  /** Where a new folder is attached when it has no parent node (the destination's own parent). */
  parentId: number | null;
  children: Map<string, Node> | null;
  keys: Set<string> | null;
}

const lower = (s: string) => s.trim().toLowerCase();
const cardKey = (front: string, back: string) => `${front.trim()}\u0000${back.trim()}`;

interface Plan {
  nodes: Node[]; // to create, parents first
  root: Node;
  accepted: { node: Node; item: ImportItem }[];
  duplicates: number;
  empty: number;
}

function plan(db: DB, userId: number, items: ImportItem[], opts: ImportOptions): Plan {
  if (items.length > MAX_IMPORT_CARDS) throw new HttpError(400, `Too many cards in one import (the limit is ${MAX_IMPORT_CARDS.toLocaleString()}).`);

  let root: Node;
  if (opts.destination.type === 'existing') {
    const row = db.prepare('SELECT id, name FROM folders WHERE id = ? AND user_id = ?').get(opts.destination.folderId, userId) as
      | { id: number; name: string }
      | undefined;
    if (!row) throw new HttpError(404, 'Folder not found');
    root = { id: row.id, name: row.name, parent: null, parentId: null, children: null, keys: null };
  } else {
    const name = opts.destination.name.trim().slice(0, 100);
    if (!name) throw new HttpError(400, 'Give the new folder a name');
    const parentId = opts.destination.parentId ?? null;
    if (parentId !== null && !db.prepare('SELECT 1 FROM folders WHERE id = ? AND user_id = ?').get(parentId, userId)) {
      throw new HttpError(404, 'Folder not found');
    }
    root = { id: null, name, parent: null, parentId, children: new Map(), keys: new Set() };
  }

  const nodes: Node[] = root.id === null ? [root] : [];

  const childOf = (node: Node, name: string): Node => {
    if (node.children === null) {
      node.children = new Map();
      for (const r of db.prepare('SELECT id, name FROM folders WHERE user_id = ? AND parent_id = ? ORDER BY id').all(userId, node.id) as {
        id: number;
        name: string;
      }[]) {
        if (!node.children.has(lower(r.name))) node.children.set(lower(r.name), { id: r.id, name: r.name, parent: node, parentId: node.id, children: null, keys: null });
      }
    }
    let child = node.children.get(lower(name));
    if (!child) {
      child = { id: null, name, parent: node, parentId: null, children: new Map(), keys: new Set() };
      node.children.set(lower(name), child);
      nodes.push(child);
    }
    return child;
  };

  const keysOf = (node: Node): Set<string> => {
    if (node.keys === null) {
      node.keys = new Set(
        (db.prepare('SELECT front, back FROM cards WHERE user_id = ? AND folder_id = ?').all(userId, node.id) as { front: string; back: string }[]).map((c) =>
          cardKey(c.front, c.back),
        ),
      );
    }
    return node.keys;
  };

  const out: Plan = { nodes, root, accepted: [], duplicates: 0, empty: 0 };
  for (const item of items) {
    if (!item.front.trim() && !item.back.trim() && !(item.images?.length)) {
      out.empty++;
      continue;
    }
    let node = root;
    if (opts.rebuildFolders) for (const segment of item.path) node = childOf(node, segment);
    // Cards with pictures are never treated as duplicates: the text may match while the pictures differ.
    if (opts.skipDuplicates && !item.images?.length) {
      const keys = keysOf(node);
      const key = cardKey(item.front, item.back);
      if (keys.has(key)) {
        out.duplicates++;
        continue;
      }
      keys.add(key);
    }
    out.accepted.push({ node, item });
  }
  return out;
}

const pathOf = (node: Node): string => (node.parent ? `${pathOf(node.parent)} / ${node.name}` : node.name);

function summarise(p: Plan): ImportSummary {
  return {
    imported: p.accepted.length,
    duplicates: p.duplicates,
    empty: p.empty,
    foldersCreated: p.nodes.length,
    newFolderPaths: p.nodes.map(pathOf),
    images: p.accepted.reduce((n, a) => n + (a.item.images?.length ?? 0), 0),
    folderId: p.root.id ?? undefined,
  };
}

/** What an import would do, without changing anything. */
export function dryRunImport(db: DB, userId: number, items: ImportItem[], opts: ImportOptions): ImportSummary {
  return summarise(plan(db, userId, items, opts));
}

/** Does the import in one all-or-nothing step. */
export function commitImport(
  db: DB,
  user: { id: number; timezone: string },
  items: ImportItem[],
  opts: ImportOptions & { uploadsDir: string },
): ImportSummary {
  const p = plan(db, user.id, items, opts);
  const now = Date.now();
  const config = makeConfig({ timezone: user.timezone });
  const fields = newCardFields(now, config);
  const writtenFiles: string[] = [];

  const insertFolder = db.prepare('INSERT INTO folders (user_id, parent_id, name, color, created_at) VALUES (?, ?, ?, ?, ?)');
  const countChildren = db.prepare('SELECT COUNT(*) AS n FROM folders WHERE user_id = ? AND parent_id IS ?');
  const insertCard = db.prepare(
    `INSERT INTO cards (user_id, folder_id, front, back, created_at, updated_at, state, ease, interval_days, due_at, step, lapses, last_reviewed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertImage = db.prepare('INSERT INTO card_images (card_id, user_id, side, filename, mime, created_at) VALUES (?, ?, ?, ?, ?, ?)');

  try {
    return db.transaction(() => {
      const createdUnder = new Map<number | null, number>();
      for (const node of p.nodes) {
        const parentId = node.parent ? node.parent.id : node.parentId;
        const base = createdUnder.get(parentId) ?? (countChildren.get(user.id, parentId) as { n: number }).n;
        createdUnder.set(parentId, base + 1);
        node.id = Number(insertFolder.run(user.id, parentId, node.name, FOLDER_COLORS[base % FOLDER_COLORS.length], now).lastInsertRowid);
      }

      const userDir = path.join(opts.uploadsDir, String(user.id));
      p.accepted.forEach(({ node, item }, i) => {
        const at = now + i; // keeps the file's order when cards are listed oldest-first
        const cardId = Number(
          insertCard.run(user.id, node.id, item.front, item.back, at, at, fields.state, fields.ease, fields.interval_days, fields.due_at, fields.step, fields.lapses, fields.last_reviewed_at)
            .lastInsertRowid,
        );
        for (const img of item.images ?? []) {
          fs.mkdirSync(userDir, { recursive: true });
          const filename = `${crypto.randomUUID()}.${img.ext}`;
          fs.writeFileSync(path.join(userDir, filename), img.data);
          writtenFiles.push(path.join(userDir, filename));
          insertImage.run(cardId, user.id, img.side, filename, img.mime, now);
        }
      });
      return summarise(p);
    })();
  } catch (err) {
    for (const f of writtenFiles) fs.rmSync(f, { force: true }); // nothing half-imported, including pictures
    throw err;
  }
}
