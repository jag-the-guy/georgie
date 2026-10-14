import { Router } from 'express';
import type { DB } from '../db';
import type { User } from '../auth';
import { HttpError } from '../http';

const DAY = 86_400_000;
const SERIES_DAYS = 30;
/** The most people the dashboard lists in one go. Plenty for now; paging can be added if the site ever outgrows it. */
const MAX_USERS = 1000;

export interface OwnerUserRow {
  id: number;
  email: string;
  createdAt: number;
  /** When they last answered a card (null: signed up but never studied). */
  lastActive: number | null;
  folders: number;
  cards: number;
  reviews: number;
  reviewsLast7Days: number;
  isYou: boolean;
}

/**
 * The owner's dashboard: who signed up and who is actually using the app.
 *
 * Access is by normal login: only accounts whose email is in ADMIN_EMAILS get in; for everyone else every route except
 * /me answers "not found", so the dashboard's existence isn't revealed. It only ever reports account-level facts
 * (email, signup date, activity counts). It never reads card text, notes or images.
 */
export function ownerRouter(db: DB, opts: { adminEmails: string[]; now?: () => number }) {
  const router = Router();
  const admins = new Set(opts.adminEmails.map((e) => e.trim().toLowerCase()).filter(Boolean));
  const now = opts.now ?? Date.now;
  const isAdmin = (user: User | undefined) => !!user && admins.has(user.email.toLowerCase());

  // Anyone logged in can ask "am I the owner?", so the app knows whether to show the Admin link.
  router.get('/me', (req, res) => {
    res.json({ admin: isAdmin(req.user) });
  });

  router.use((req, _res, next) => {
    if (!isAdmin(req.user)) throw new HttpError(404, 'Not found');
    next();
  });

  const count = (sql: string, ...args: number[]) => (db.prepare(sql).get(...args) as { n: number }).n;

  router.get('/overview', (_req, res) => {
    const t = now();
    const since = (days: number) => t - days * DAY;
    const signedUp = (days: number) => count('SELECT COUNT(*) AS n FROM users WHERE created_at >= ?', since(days));
    const active = (days: number) => count('SELECT COUNT(DISTINCT user_id) AS n FROM review_log WHERE reviewed_at >= ?', since(days));

    // One entry per UTC day for the last 30 days, oldest first, with zeros filled in.
    const dayKey = (ms: number) => new Date(ms).toISOString().slice(0, 10);
    const signupRows = db
      .prepare(`SELECT date(created_at / 1000, 'unixepoch') AS d, COUNT(*) AS n FROM users WHERE created_at >= ? GROUP BY d`)
      .all(since(SERIES_DAYS)) as { d: string; n: number }[];
    const activeRows = db
      .prepare(`SELECT date(reviewed_at / 1000, 'unixepoch') AS d, COUNT(DISTINCT user_id) AS n FROM review_log WHERE reviewed_at >= ? GROUP BY d`)
      .all(since(SERIES_DAYS)) as { d: string; n: number }[];
    const signupsBy = new Map(signupRows.map((r) => [r.d, r.n]));
    const activeBy = new Map(activeRows.map((r) => [r.d, r.n]));
    const series = Array.from({ length: SERIES_DAYS }, (_, i) => {
      const date = dayKey(t - (SERIES_DAYS - 1 - i) * DAY);
      return { date, signups: signupsBy.get(date) ?? 0, active: activeBy.get(date) ?? 0 };
    });

    res.json({
      totals: {
        users: count('SELECT COUNT(*) AS n FROM users'),
        folders: count('SELECT COUNT(*) AS n FROM folders'),
        cards: count('SELECT COUNT(*) AS n FROM cards'),
        reviews: count('SELECT COUNT(*) AS n FROM review_log'),
        neverStudied: count('SELECT COUNT(*) AS n FROM users u WHERE NOT EXISTS (SELECT 1 FROM review_log r WHERE r.user_id = u.id)'),
      },
      newUsers: { last24h: signedUp(1), last7d: signedUp(7), last30d: signedUp(30) },
      activeUsers: { last24h: active(1), last7d: active(7), last30d: active(30) },
      series,
      generatedAt: t,
    });
  });

  router.get('/users', (req, res) => {
    const t = now();
    const rows = db
      .prepare(
        `SELECT u.id, u.email, u.created_at AS createdAt,
           (SELECT MAX(r.reviewed_at) FROM review_log r WHERE r.user_id = u.id) AS lastActive,
           (SELECT COUNT(*) FROM folders f WHERE f.user_id = u.id) AS folders,
           (SELECT COUNT(*) FROM cards c WHERE c.user_id = u.id) AS cards,
           (SELECT COUNT(*) FROM review_log r WHERE r.user_id = u.id) AS reviews,
           (SELECT COUNT(*) FROM review_log r WHERE r.user_id = u.id AND r.reviewed_at >= ?) AS reviewsLast7Days
         FROM users u ORDER BY u.created_at DESC, u.id DESC LIMIT ?`,
      )
      .all(t - 7 * DAY, MAX_USERS) as Omit<OwnerUserRow, 'isYou'>[];
    const total = count('SELECT COUNT(*) AS n FROM users');
    res.json({ users: rows.map((r) => ({ ...r, isYou: r.id === req.user!.id })), total, truncated: total > rows.length });
  });

  return router;
}
