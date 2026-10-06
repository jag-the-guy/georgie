import { Router } from 'express';
import { z } from 'zod';
import type { DB } from '../db';
import { SUBTREE_CTE } from '../db';
import { HttpError, idParam, parse } from '../http';
import { configFor, unlinkImageFiles } from '../cards';
import { dueTodayCount } from '../queue';
import type { Folder } from '../../shared/types';

export const FOLDER_COLORS = ['lavender', 'peach', 'sky', 'mint', 'rose', 'lemon'] as const;

const folderBody = z.object({
  name: z.string().trim().min(1, 'Folder name is required').max(100),
  parent_id: z.number().int().positive().nullable().optional(),
  color: z.enum(FOLDER_COLORS).optional(),
  new_per_day: z.number().int().min(0).max(9999).nullable().optional(),
});

export function folderRouter(db: DB, uploadsDir: string) {
  const router = Router();

  const getFolder = (userId: number, id: number) => {
    const folder = db.prepare('SELECT * FROM folders WHERE id = ? AND user_id = ?').get(id, userId) as Folder | undefined;
    if (!folder) throw new HttpError(404, 'Folder not found');
    return folder;
  };

  // All of the user's folders, flat, with counts that include every subfolder.
  router.get('/', (req, res) => {
    const user = req.user!;
    const config = configFor(user);
    const now = Date.now();
    const folders = db
      .prepare('SELECT id, parent_id, name, color, new_per_day, created_at FROM folders WHERE user_id = ? ORDER BY name COLLATE NOCASE')
      .all(user.id) as Folder[];
    const direct = db
      .prepare(
        `SELECT folder_id, COUNT(*) AS total, SUM(state = 'review') AS learned
         FROM cards WHERE user_id = ? GROUP BY folder_id`,
      )
      .all(user.id) as { folder_id: number; total: number; learned: number }[];
    const directMap = new Map(direct.map((d) => [d.folder_id, d]));
    const children = new Map<number | null, Folder[]>();
    for (const f of folders) children.set(f.parent_id, [...(children.get(f.parent_id) ?? []), f]);

    const totals = new Map<number, { total: number; learned: number }>();
    const sum = (f: Folder): { total: number; learned: number } => {
      const own = directMap.get(f.id);
      const acc = { total: own?.total ?? 0, learned: own?.learned ?? 0 };
      for (const child of children.get(f.id) ?? []) {
        const c = sum(child);
        acc.total += c.total;
        acc.learned += c.learned;
      }
      totals.set(f.id, acc);
      return acc;
    };
    for (const root of children.get(null) ?? []) sum(root);

    res.json({
      folders: folders.map((f) => ({
        ...f,
        card_count: totals.get(f.id)?.total ?? 0,
        learned_count: totals.get(f.id)?.learned ?? 0,
        due_count: dueTodayCount(db, user.id, f.id, now, config),
      })),
    });
  });

  router.post('/', (req, res) => {
    const user = req.user!;
    const body = parse(folderBody, req.body);
    if (body.parent_id) getFolder(user.id, body.parent_id);
    const siblings = (
      db
        .prepare('SELECT COUNT(*) AS n FROM folders WHERE user_id = ? AND parent_id IS ?')
        .get(user.id, body.parent_id ?? null) as { n: number }
    ).n;
    const color = body.color ?? FOLDER_COLORS[siblings % FOLDER_COLORS.length];
    const { lastInsertRowid } = db
      .prepare('INSERT INTO folders (user_id, parent_id, name, color, new_per_day, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(user.id, body.parent_id ?? null, body.name, color, body.new_per_day ?? null, Date.now());
    res.status(201).json({ folder: getFolder(user.id, Number(lastInsertRowid)) });
  });

  router.patch('/:id', (req, res) => {
    const user = req.user!;
    const id = parse(idParam, req.params.id);
    const folder = getFolder(user.id, id);
    const body = parse(folderBody.partial(), req.body);

    if (body.parent_id !== undefined && body.parent_id !== null) {
      getFolder(user.id, body.parent_id);
      const inSubtree = db
        .prepare(`${SUBTREE_CTE} SELECT 1 FROM sub WHERE id = ?`)
        .get(id, user.id, body.parent_id);
      if (inSubtree) throw new HttpError(400, "A folder can't be moved inside itself");
    }

    const next = { ...folder, ...body };
    db.prepare('UPDATE folders SET name = ?, parent_id = ?, color = ?, new_per_day = ? WHERE id = ? AND user_id = ?').run(
      next.name,
      next.parent_id ?? null,
      next.color,
      next.new_per_day ?? null,
      id,
      user.id,
    );
    res.json({ folder: getFolder(user.id, id) });
  });

  // Puts every card in this folder and its subfolders back to "new". Review history is kept.
  router.post('/:id/reset', (req, res) => {
    const user = req.user!;
    const id = parse(idParam, req.params.id);
    getFolder(user.id, id);
    const now = Date.now();
    const { changes } = db
      .prepare(
        `${SUBTREE_CTE}
         UPDATE cards SET state = 'new', ease = ?, interval_days = 0, due_at = ?, step = 0, lapses = 0, last_reviewed_at = NULL
         WHERE user_id = ? AND folder_id IN (SELECT id FROM sub)`,
      )
      .run(id, user.id, configFor(user).startingEase, now, user.id);
    res.json({ reset: changes });
  });

  router.delete('/:id', (req, res) => {
    const user = req.user!;
    const id = parse(idParam, req.params.id);
    getFolder(user.id, id);
    const images = db
      .prepare(
        `${SUBTREE_CTE} SELECT i.user_id, i.filename FROM card_images i JOIN cards c ON c.id = i.card_id
         WHERE c.user_id = ? AND c.folder_id IN (SELECT id FROM sub)`,
      )
      .all(id, user.id, user.id) as { user_id: number; filename: string }[];
    db.prepare('DELETE FROM folders WHERE id = ? AND user_id = ?').run(id, user.id);
    unlinkImageFiles(uploadsDir, images);
    res.json({ ok: true });
  });

  return router;
}
