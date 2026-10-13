import type { DB } from '../db';

const dayOf = (now: number) => new Date(now).toISOString().slice(0, 10);

export function usedToday(db: DB, userId: number, now = Date.now()): number {
  const row = db.prepare('SELECT jobs FROM ai_usage WHERE user_id = ? AND day = ?').get(userId, dayOf(now)) as { jobs: number } | undefined;
  return row?.jobs ?? 0;
}

/** Uses up one of today's goes, if any are left. All in one step, so two quick clicks can't both slip through. */
export function takeQuota(db: DB, userId: number, limit: number, now = Date.now()): boolean {
  return db.transaction(() => {
    const day = dayOf(now);
    db.prepare('INSERT OR IGNORE INTO ai_usage (user_id, day, jobs) VALUES (?, ?, 0)').run(userId, day);
    const { changes } = db.prepare('UPDATE ai_usage SET jobs = jobs + 1 WHERE user_id = ? AND day = ? AND jobs < ?').run(userId, day, limit);
    return changes === 1;
  })();
}

/** Gives a go back when the AI failed or the person cancelled, since they got nothing for it. */
export function refundQuota(db: DB, userId: number, now = Date.now()) {
  db.prepare('UPDATE ai_usage SET jobs = MAX(0, jobs - 1) WHERE user_id = ? AND day = ?').run(userId, dayOf(now));
}
