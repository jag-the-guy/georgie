import { Router } from 'express';
import { z } from 'zod';
import type { DB } from '../db';
import { HttpError, idParam, parse } from '../http';
import { configFor, loadCard, loadCards, subtreeCardIds, unlinkImageFiles } from '../cards';
import { newCardFields } from '../../shared/scheduler';

const cardBody = z.object({
  front: z.string().max(20_000),
  back: z.string().max(20_000),
  folder_id: z.number().int().positive().optional(),
});

export function cardRouter(db: DB, uploadsDir: string) {
  const router = Router();

  const assertFolder = (userId: number, folderId: number) => {
    if (!db.prepare('SELECT 1 FROM folders WHERE id = ? AND user_id = ?').get(folderId, userId)) {
      throw new HttpError(404, 'Folder not found');
    }
  };
  const getCard = (userId: number, id: number) => {
    const card = loadCard(db, userId, id);
    if (!card) throw new HttpError(404, 'Card not found');
    return card;
  };

  // Cards directly inside a folder, newest first. With ?deep=1: the folder's whole subtree in reading order (for browsing).
  router.get('/folders/:id/cards', (req, res) => {
    const user = req.user!;
    const folderId = parse(idParam, req.params.id);
    assertFolder(user.id, folderId);
    if (req.query.deep === '1') {
      res.json({ cards: loadCards(db, user.id, subtreeCardIds(db, user.id, folderId)) });
      return;
    }
    const ids = (
      db.prepare('SELECT id FROM cards WHERE user_id = ? AND folder_id = ? ORDER BY created_at DESC, id DESC').all(user.id, folderId) as {
        id: number;
      }[]
    ).map((r) => r.id);
    res.json({ cards: loadCards(db, user.id, ids) });
  });

  router.post('/folders/:id/cards', (req, res) => {
    const user = req.user!;
    const folderId = parse(idParam, req.params.id);
    assertFolder(user.id, folderId);
    const body = parse(cardBody.omit({ folder_id: true }), req.body);
    const now = Date.now();
    const s = newCardFields(now, configFor(user));
    const { lastInsertRowid } = db
      .prepare(
        `INSERT INTO cards (user_id, folder_id, front, back, created_at, updated_at,
           state, ease, interval_days, due_at, step, lapses, last_reviewed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(user.id, folderId, body.front, body.back, now, now, s.state, s.ease, s.interval_days, s.due_at, s.step, s.lapses, s.last_reviewed_at);
    res.status(201).json({ card: getCard(user.id, Number(lastInsertRowid)) });
  });

  router.get('/cards/search', (req, res) => {
    const user = req.user!;
    const q = parse(z.string().trim().min(1).max(200), req.query.q);
    const like = `%${q.replace(/[\\%_]/g, (m) => '\\' + m)}%`;
    const ids = (
      db
        .prepare(
          `SELECT id FROM cards WHERE user_id = ? AND (front LIKE ? ESCAPE '\\' OR back LIKE ? ESCAPE '\\')
           ORDER BY updated_at DESC LIMIT 50`,
        )
        .all(user.id, like, like) as { id: number }[]
    ).map((r) => r.id);
    res.json({ cards: loadCards(db, user.id, ids) });
  });

  router.patch('/cards/:id', (req, res) => {
    const user = req.user!;
    const id = parse(idParam, req.params.id);
    const card = getCard(user.id, id);
    const body = parse(cardBody.partial(), req.body);
    if (body.folder_id) assertFolder(user.id, body.folder_id);
    db.prepare('UPDATE cards SET front = ?, back = ?, folder_id = ?, updated_at = ? WHERE id = ? AND user_id = ?').run(
      body.front ?? card.front,
      body.back ?? card.back,
      body.folder_id ?? card.folder_id,
      Date.now(),
      id,
      user.id,
    );
    res.json({ card: getCard(user.id, id) });
  });

  router.delete('/cards/:id', (req, res) => {
    const user = req.user!;
    const id = parse(idParam, req.params.id);
    getCard(user.id, id);
    const images = db.prepare('SELECT user_id, filename FROM card_images WHERE card_id = ? AND user_id = ?').all(id, user.id) as {
      user_id: number;
      filename: string;
    }[];
    db.prepare('DELETE FROM cards WHERE id = ? AND user_id = ?').run(id, user.id);
    unlinkImageFiles(uploadsDir, images);
    res.json({ ok: true });
  });

  return router;
}
