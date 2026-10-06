import { Router, type RequestHandler } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { z } from 'zod';
import type { DB } from './db';
import { HttpError, parse } from './http';
import { isValidTimezone } from '../shared/time';

export interface User {
  id: number;
  email: string;
  timezone: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

const COOKIE = 'sid';
const SESSION_DAYS = 30;
const BCRYPT_COST = 12;
// Compared against when the email doesn't exist, so login takes the same time either way.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', BCRYPT_COST);

const credentials = z.object({
  email: z.email('Enter a valid email address').max(254),
  password: z.string().min(8, 'Password must be at least 8 characters').max(200),
  timezone: z.string().max(64).optional(),
});

const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

/** Very small in-memory limiter for failed logins: 10 failures per email+IP per 15 minutes. */
const failures = new Map<string, { count: number; resetAt: number }>();
function checkLimit(key: string, now: number) {
  const entry = failures.get(key);
  if (entry && entry.resetAt > now && entry.count >= 10) {
    throw new HttpError(429, 'Too many attempts. Try again in a few minutes.');
  }
}
function recordFailure(key: string, now: number) {
  const entry = failures.get(key);
  if (!entry || entry.resetAt <= now) failures.set(key, { count: 1, resetAt: now + 15 * 60_000 });
  else entry.count++;
}

export function authRouter(db: DB, opts: { secureCookies: boolean }) {
  const router = Router();

  const startSession = (res: Parameters<RequestHandler>[1], userId: number) => {
    const token = crypto.randomBytes(32).toString('base64url');
    const expiresAt = Date.now() + SESSION_DAYS * 86_400_000;
    db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(sha256(token), userId, expiresAt);
    res.cookie(COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: opts.secureCookies,
      maxAge: SESSION_DAYS * 86_400_000,
      path: '/',
    });
  };

  const tz = (value: string | undefined) => (value && isValidTimezone(value) ? value : 'UTC');

  router.post('/signup', async (req, res) => {
    const body = parse(credentials, req.body);
    const email = body.email.trim().toLowerCase();
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) {
      throw new HttpError(409, 'An account with that email already exists. Try logging in.');
    }
    const hash = await bcrypt.hash(body.password, BCRYPT_COST);
    const { lastInsertRowid } = db
      .prepare('INSERT INTO users (email, password_hash, timezone, created_at) VALUES (?, ?, ?, ?)')
      .run(email, hash, tz(body.timezone), Date.now());
    const userId = Number(lastInsertRowid);
    startSession(res, userId);
    res.status(201).json({ user: { id: userId, email, timezone: tz(body.timezone) } });
  });

  router.post('/login', async (req, res) => {
    const body = parse(credentials.extend({ password: z.string().min(1).max(200) }), req.body);
    const email = body.email.trim().toLowerCase();
    const key = `${email}|${req.ip}`;
    const now = Date.now();
    checkLimit(key, now);

    const row = db.prepare('SELECT id, password_hash FROM users WHERE email = ?').get(email) as
      | { id: number; password_hash: string }
      | undefined;
    const ok = await bcrypt.compare(body.password, row?.password_hash ?? DUMMY_HASH);
    if (!row || !ok) {
      recordFailure(key, now);
      throw new HttpError(401, 'Email or password is incorrect');
    }
    failures.delete(key);
    const timezone = tz(body.timezone);
    db.prepare('UPDATE users SET timezone = ? WHERE id = ?').run(timezone, row.id);
    startSession(res, row.id);
    res.json({ user: { id: row.id, email, timezone } });
  });

  router.post('/logout', (req, res) => {
    const token = req.cookies?.[COOKIE];
    if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
    res.clearCookie(COOKIE, { path: '/' });
    res.json({ ok: true });
  });

  router.get('/me', (req, res) => {
    res.json({ user: userFromRequest(db, req.cookies?.[COOKIE]) ?? null });
  });

  return router;
}

function userFromRequest(db: DB, token: string | undefined): User | undefined {
  if (!token) return undefined;
  return db
    .prepare(
      `SELECT u.id, u.email, u.timezone FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > ?`,
    )
    .get(sha256(token), Date.now()) as User | undefined;
}

export function requireAuth(db: DB): RequestHandler {
  return (req, _res, next) => {
    const user = userFromRequest(db, req.cookies?.[COOKIE]);
    if (!user) throw new HttpError(401, 'Please log in');
    req.user = user;
    next();
  };
}
