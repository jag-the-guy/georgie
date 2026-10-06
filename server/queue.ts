import type { DB } from './db';
import { SUBTREE_CTE } from './db';
import type { SrsConfig } from '../shared/srsConfig';
import type { QueueCounts } from '../shared/types';
import { addStudyDays, studyDayStart } from '../shared/time';

export interface QueueResult {
  nextCardId: number | null;
  counts: QueueCounts;
  /** When nothing is left: the time the next card becomes available, or null if the folder is empty. */
  nextDueAt: number | null;
}

/** The daily new-card limit for a folder: its own setting, or the config default. */
export function newLimitFor(db: DB, userId: number, folderId: number, config: SrsConfig): number {
  const row = db.prepare('SELECT new_per_day FROM folders WHERE id = ? AND user_id = ?').get(folderId, userId) as
    | { new_per_day: number | null }
    | undefined;
  return row?.new_per_day ?? config.newPerDay;
}

/**
 * Builds the study queue for a folder and all of its subfolders.
 * Order: due learning/relearning (earliest first), due reviews (most overdue first),
 * new cards (oldest first, within the daily limit). A learning card that isn't due yet is never shown early:
 * when only those remain, there is no next card and `nextDueAt` says when the soonest one comes back.
 */
export function getQueue(db: DB, userId: number, folderId: number, now: number, config: SrsConfig): QueueResult {
  const p = [folderId, userId];
  const inSubtree = `user_id = ? AND folder_id IN (SELECT id FROM sub)`;
  const dayStart = studyDayStart(now, config.timezone, config.dayStartHour);
  const nextDayStart = addStudyDays(now, 1, config.timezone, config.dayStartHour);

  const first = (sql: string, ...args: unknown[]) =>
    (db.prepare(`${SUBTREE_CTE} ${sql}`).get(...p, userId, ...args) as { id: number } | undefined)?.id ?? null;
  const count = (sql: string, ...args: unknown[]) =>
    (db.prepare(`${SUBTREE_CTE} ${sql}`).get(...p, userId, ...args) as { n: number }).n;

  const introducedToday = count(
    `SELECT COUNT(DISTINCT r.card_id) AS n FROM review_log r JOIN cards c ON c.id = r.card_id
     WHERE c.user_id = ? AND c.folder_id IN (SELECT id FROM sub) AND c.state != 'new'
       AND r.state_before = 'new' AND r.reviewed_at >= ?`,
    dayStart,
  );
  const newTotal = count(`SELECT COUNT(*) AS n FROM cards WHERE ${inSubtree} AND state = 'new'`);
  const newAllowed = Math.min(newTotal, Math.max(0, newLimitFor(db, userId, folderId, config) - introducedToday));

  const counts: QueueCounts = {
    new: newAllowed,
    // Every learning card comes back within minutes, so all of them count as remaining this session.
    learning: count(`SELECT COUNT(*) AS n FROM cards WHERE ${inSubtree} AND state IN ('learning', 'relearning')`),
    review: count(`SELECT COUNT(*) AS n FROM cards WHERE ${inSubtree} AND state = 'review' AND due_at <= ?`, now),
  };

  const nextCardId =
    first(
      `SELECT id FROM cards WHERE ${inSubtree} AND state IN ('learning', 'relearning') AND due_at <= ?
       ORDER BY due_at, id LIMIT 1`,
      now,
    ) ??
    first(`SELECT id FROM cards WHERE ${inSubtree} AND state = 'review' AND due_at <= ? ORDER BY due_at, id LIMIT 1`, now) ??
    (newAllowed > 0 ? first(`SELECT id FROM cards WHERE ${inSubtree} AND state = 'new' ORDER BY created_at, id LIMIT 1`) : null);

  let nextDueAt: number | null = null;
  if (nextCardId === null) {
    const soonest = db
      .prepare(`${SUBTREE_CTE} SELECT MIN(due_at) AS t FROM cards WHERE ${inSubtree} AND state != 'new'`)
      .get(...p, userId) as { t: number | null };
    const candidates = [soonest.t, newTotal > 0 ? nextDayStart : null].filter((t): t is number => t !== null);
    nextDueAt = candidates.length ? Math.min(...candidates) : null;
  }

  return { nextCardId, counts, nextDueAt };
}

/** Cards left to study today in the subtree. Review cards always fall due at 4am, so "due now" is "due today". */
export function dueTodayCount(db: DB, userId: number, folderId: number, now: number, config: SrsConfig): number {
  const { counts } = getQueue(db, userId, folderId, now, config);
  return counts.new + counts.learning + counts.review;
}
