import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { openDb, type DB } from '../server/db';
import { createApp } from '../server/app';

const DAY = 86_400_000;

describe("the owner's dashboard", () => {
  let server: ReturnType<ReturnType<typeof createApp>['listen']>;
  let base: string;
  let db: DB;
  const clock = Date.UTC(2026, 9, 14, 12);
  const ids: Record<string, number> = {};
  let ownerCookie: string;
  let userCookie: string;

  async function signup(email: string) {
    const res = await fetch(`${base}/auth/signup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'correct horse' }) });
    ids[email] = (await res.json()).user.id;
    return res.headers.get('set-cookie')!.split(';')[0];
  }
  const get = (cookie: string | null, url: string) => fetch(`${base}${url}`, { headers: cookie ? { cookie } : {} });
  const review = (email: string, at: number, n = 1) => {
    for (let i = 0; i < n; i++) {
      db.prepare("INSERT INTO review_log (card_id, user_id, rating, reviewed_at, state_before, interval_before, interval_after, ease_after) VALUES (1, ?, 3, ?, 'new', 0, 1, 2.5)").run(ids[email], at - i);
    }
  };
  const setCreated = (email: string, at: number) => db.prepare('UPDATE users SET created_at = ? WHERE id = ?').run(at, ids[email]);

  beforeAll(async () => {
    db = openDb(':memory:');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flashcards-owner-'));
    server = createApp(db, { uploadsDir: path.join(dir, 'uploads'), adminEmails: ['Owner@Example.com'], now: () => clock }).listen(0);
    await new Promise((r) => server.once('listening', r));
    base = `http://localhost:${(server.address() as AddressInfo).port}/api`;

    ownerCookie = await signup('owner@example.com');
    userCookie = await signup('ann@example.com');
    await signup('ben@example.com'); // signs up, never studies
    await signup('cat@example.com'); // studied only long ago

    setCreated('owner@example.com', clock - 60 * DAY);
    setCreated('ann@example.com', clock - 3 * DAY);
    setCreated('ben@example.com', clock - 2 * 3600_000);
    setCreated('cat@example.com', clock - 20 * DAY);
    review('ann@example.com', clock - 1000, 3); // today
    review('ann@example.com', clock - 3 * DAY, 2);
    review('owner@example.com', clock - 5 * DAY);
    review('cat@example.com', clock - 20 * DAY);
    db.prepare('INSERT INTO folders (user_id, name, color, created_at) VALUES (?, ?, ?, ?)').run(ids['ann@example.com'], 'Secret biology', 'sky', clock);
    db.prepare("INSERT INTO cards (user_id, folder_id, front, back, created_at, updated_at, due_at) VALUES (?, 1, 'PRIVATE FRONT', 'PRIVATE BACK', ?, ?, ?)").run(ids['ann@example.com'], clock, clock, clock);
  });
  afterAll(() => server.close());

  it('needs a login', async () => {
    expect((await get(null, '/owner/me')).status).toBe(401);
    expect((await get(null, '/owner/overview')).status).toBe(401);
    expect((await get(null, '/owner/users')).status).toBe(401);
  });

  it('tells each person whether they are the owner (email match ignores capitals)', async () => {
    expect(await (await get(ownerCookie, '/owner/me')).json()).toEqual({ admin: true });
    expect(await (await get(userCookie, '/owner/me')).json()).toEqual({ admin: false });
  });

  it('is invisible to everyone else: "not found", with no data', async () => {
    for (const url of ['/owner/overview', '/owner/users']) {
      const res = await get(userCookie, url);
      expect(res.status).toBe(404);
      expect(JSON.stringify(await res.json())).not.toContain('@');
    }
  });

  it('is off for everybody when ADMIN_EMAILS is empty', async () => {
    const other = createApp(db, { uploadsDir: path.join(os.tmpdir(), 'x'), now: () => clock }).listen(0);
    await new Promise((r) => other.once('listening', r));
    const url = `http://localhost:${(other.address() as AddressInfo).port}/api/owner`;
    expect((await (await fetch(`${url}/me`, { headers: { cookie: ownerCookie } })).json())).toEqual({ admin: false });
    expect((await fetch(`${url}/users`, { headers: { cookie: ownerCookie } })).status).toBe(404);
    other.close();
  });

  it('counts signups and active people over 24 hours, 7 days and 30 days', async () => {
    const o = await (await get(ownerCookie, '/owner/overview')).json();
    expect(o.totals).toMatchObject({ users: 4, folders: 1, cards: 1, reviews: 7, neverStudied: 1 });
    expect(o.newUsers).toEqual({ last24h: 1, last7d: 2, last30d: 3 }); // ben; ben+ann; ben+ann+cat
    expect(o.activeUsers).toEqual({ last24h: 1, last7d: 2, last30d: 3 }); // ann; ann+owner; ann+owner+cat
  });

  it('gives 30 daily points, oldest first, ending today, with zeros filled in', async () => {
    const { series } = await (await get(ownerCookie, '/owner/overview')).json();
    expect(series).toHaveLength(30);
    expect(series[29].date).toBe('2026-10-14');
    expect(series[0].date).toBe('2026-09-15');
    expect(series[29]).toEqual({ date: '2026-10-14', signups: 1, active: 1 });
    expect(series.find((d: { date: string }) => d.date === '2026-10-11')).toMatchObject({ signups: 1, active: 1 }); // ann signed up and studied 3 days ago
    expect(series.find((d: { date: string }) => d.date === '2026-10-01')).toEqual({ date: '2026-10-01', signups: 0, active: 0 });
  });

  it('lists everyone newest first with activity counts', async () => {
    const body = await (await get(ownerCookie, '/owner/users')).json();
    expect(body.total).toBe(4);
    expect(body.truncated).toBe(false);
    expect(body.users.map((u: { email: string }) => u.email)).toEqual(['ben@example.com', 'ann@example.com', 'cat@example.com', 'owner@example.com']);
    const ann = body.users.find((u: { email: string }) => u.email === 'ann@example.com');
    expect(ann).toMatchObject({ folders: 1, cards: 1, reviews: 5, reviewsLast7Days: 5, lastActive: clock - 1000, isYou: false });
    const ben = body.users[0];
    expect(ben).toMatchObject({ lastActive: null, reviews: 0, folders: 0, cards: 0 });
    expect(body.users.find((u: { email: string }) => u.email === 'owner@example.com').isYou).toBe(true);
  });

  it('never exposes card text, folder names or password data', async () => {
    const text = JSON.stringify(await (await get(ownerCookie, '/owner/users')).json()) + JSON.stringify(await (await get(ownerCookie, '/owner/overview')).json());
    for (const secret of ['PRIVATE FRONT', 'PRIVATE BACK', 'Secret biology', 'password', 'hash']) expect(text).not.toContain(secret);
  });
});
