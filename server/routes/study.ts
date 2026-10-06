import { Router } from 'express';
import { z } from 'zod';
import type { DB } from '../db';
import { HttpError, idParam, parse } from '../http';
import { configFor, loadCard } from '../cards';
import { getQueue } from '../queue';
import { schedule } from '../../shared/scheduler';
import type { NextCardResponse, Rating } from '../../shared/types';
import type { User } from '../auth';
import { studyDay, studyDayStart } from '../../shared/time';

const rateBody = z.object({
  cardId: z.number().int().positive(),
  rating: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
});

export function studyRouter(db: DB) {
  const router = Router();

  const assertFolder = (userId: number, folderId: number) => {
    if (!db.prepare('SELECT 1 FROM folders WHERE id = ? AND user_id = ?').get(folderId, userId)) {
      throw new HttpError(404, 'Folder not found');
    }
  };

  const nextFor = (user: User, folderId: number): NextCardResponse => {
    const q = getQueue(db, user.id, folderId, Date.now(), configFor(user));
    if (q.nextCardId === null) return { done: true, nextDueAt: q.nextDueAt, counts: q.counts };
    return { done: false, card: loadCard(db, user.id, q.nextCardId)!, counts: q.counts };
  };

  router.get('/study/:folderId/next', (req, res) => {
    const folderId = parse(idParam, req.params.folderId);
    assertFolder(req.user!.id, folderId);
    res.json(nextFor(req.user!, folderId));
  });

  router.post('/study/:folderId/rate', (req, res) => {
    const user = req.user!;
    const folderId = parse(idParam, req.params.folderId);
    assertFolder(user.id, folderId);
    const { cardId, rating } = parse(rateBody, req.body);
    const card = loadCard(db, user.id, cardId);
    if (!card) throw new HttpError(404, 'Card not found');

    const now = Date.now();
    const next = schedule(card, rating as Rating, now, configFor(user));
    db.transaction(() => {
      db.prepare(
        `UPDATE cards SET state = ?, ease = ?, interval_days = ?, due_at = ?, step = ?, lapses = ?, last_reviewed_at = ?
         WHERE id = ? AND user_id = ?`,
      ).run(next.state, next.ease, next.interval_days, next.due_at, next.step, next.lapses, next.last_reviewed_at, cardId, user.id);
      db.prepare(
        `INSERT INTO review_log (card_id, user_id, rating, reviewed_at, state_before, interval_before, interval_after, ease_after)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(cardId, user.id, rating, now, card.state, card.interval_days, next.interval_days, next.ease);
    })();

    res.json(nextFor(user, folderId));
  });

  // Review cards due on each study day of a month, for the dashboard calendar.
  router.get('/stats/calendar', (req, res) => {
    const user = req.user!;
    const { year, month } = parse(
      z.object({ year: z.coerce.number().int().min(2000).max(3000), month: z.coerce.number().int().min(1).max(12) }),
      req.query,
    );
    const config = configFor(user);
    // Generous UTC window around the month; exact days are worked out in the user's timezone below.
    const from = Date.UTC(year, month - 1, 1) - 2 * 86_400_000;
    const to = Date.UTC(year, month, 1) + 2 * 86_400_000;
    const rows = db
      .prepare(`SELECT due_at FROM cards WHERE user_id = ? AND state = 'review' AND due_at >= ? AND due_at < ?`)
      .all(user.id, from, to) as { due_at: number }[];
    const days: Record<number, number> = {};
    for (const { due_at } of rows) {
      const d = studyDay(due_at, config.timezone, config.dayStartHour);
      if (d.year === year && d.month === month) days[d.day] = (days[d.day] ?? 0) + 1;
    }
    const reviewedToday = (
      db
        .prepare('SELECT COUNT(*) AS n FROM review_log WHERE user_id = ? AND reviewed_at >= ?')
        .get(user.id, studyDayStart(Date.now(), config.timezone, config.dayStartHour)) as { n: number }
    ).n;
    res.json({ days, reviewedToday });
  });

  return router;
}
