import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { openDb, type DB } from '../server/db';
import { getQueue } from '../server/queue';
import { createApp } from '../server/app';
import { makeConfig } from '../shared/srsConfig';
import { schedule } from '../shared/scheduler';
import type { CardState, Rating, SchedCard } from '../shared/types';

const MIN = 60_000;
const config = makeConfig({ timezone: 'UTC' });
const NOW = Date.UTC(2026, 5, 10, 12, 0); // June 10, noon UTC

let db: DB;
let userId: number;
let otherUserId: number;
let root: number;
let child: number;

function addUser(email: string) {
  return Number(db.prepare("INSERT INTO users (email, password_hash, created_at) VALUES (?, 'x', 0)").run(email).lastInsertRowid);
}
function addFolder(owner: number, parent: number | null, newPerDay: number | null = null) {
  return Number(
    db
      .prepare('INSERT INTO folders (user_id, parent_id, name, new_per_day, created_at) VALUES (?, ?, ?, ?, 0)')
      .run(owner, parent, 'f', newPerDay).lastInsertRowid,
  );
}
function addCard(folder: number, state: CardState, due_at: number, created_at = 0, owner = userId) {
  return Number(
    db
      .prepare(
        `INSERT INTO cards (user_id, folder_id, front, back, created_at, updated_at, state, due_at, interval_days)
         VALUES (?, ?, 'q', 'a', ?, ?, ?, ?, ?)`,
      )
      .run(owner, folder, created_at, created_at, state, due_at, state === 'review' ? 5 : 0).lastInsertRowid,
  );
}
/** Mimics the rate endpoint: schedule, save, and log. */
function rate(cardId: number, rating: Rating, now: number) {
  const card = db.prepare('SELECT * FROM cards WHERE id = ?').get(cardId) as SchedCard;
  const next = schedule(card, rating, now, config);
  db.prepare('UPDATE cards SET state=?, ease=?, interval_days=?, due_at=?, step=?, lapses=?, last_reviewed_at=? WHERE id=?').run(
    next.state, next.ease, next.interval_days, next.due_at, next.step, next.lapses, next.last_reviewed_at, cardId,
  );
  db.prepare(
    `INSERT INTO review_log (card_id, user_id, rating, reviewed_at, state_before, interval_before, interval_after, ease_after)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(cardId, userId, rating, now, card.state, card.interval_days, next.interval_days, next.ease);
}
const queue = (now = NOW, folder = root, user = userId) => getQueue(db, user, folder, now, config);

beforeEach(() => {
  db = openDb(':memory:');
  userId = addUser('a@example.com');
  otherUserId = addUser('b@example.com');
  root = addFolder(userId, null);
  child = addFolder(userId, root);
});

describe('study queue order', () => {
  it('learning due first, then most overdue review, then oldest new', () => {
    const newOld = addCard(child, 'new', 0, 1);
    addCard(root, 'new', 0, 2);
    const reviewOverdue = addCard(root, 'review', NOW - 3 * 86_400_000);
    const reviewRecent = addCard(child, 'review', NOW - 86_400_000);
    const learnLater = addCard(root, 'learning', NOW - 1 * MIN);
    const learnEarly = addCard(child, 'relearning', NOW - 5 * MIN);

    // Take each card out of the way (due far in the future) once it has been checked.
    const later = (id: number) => db.prepare('UPDATE cards SET due_at = ? WHERE id = ?').run(NOW + 10 * 86_400_000, id);
    for (const id of [learnEarly, learnLater, reviewOverdue, reviewRecent]) {
      expect(queue().nextCardId).toBe(id);
      later(id);
    }
    expect(queue().nextCardId).toBe(newOld);
  });

  it('includes cards from nested subfolders', () => {
    const grandchild = addFolder(userId, child);
    const id = addCard(grandchild, 'review', NOW - MIN);
    expect(queue().nextCardId).toBe(id);
    expect(queue().counts.review).toBe(1);
  });

  it('does not include a review card until its due time', () => {
    addCard(root, 'review', Date.UTC(2026, 5, 11, 4));
    expect(queue().nextCardId).toBeNull();
    expect(queue(Date.UTC(2026, 5, 11, 3, 59)).nextCardId).toBeNull();
    expect(queue(Date.UTC(2026, 5, 11, 4, 0)).nextCardId).not.toBeNull();
  });

  it('never shows a learning card before it is due, even when it is the only card left', () => {
    addCard(root, 'learning', NOW + 10 * MIN);
    const sooner = addCard(root, 'learning', NOW + 2 * MIN);
    addCard(root, 'review', NOW + 5 * 86_400_000);
    const waiting = queue();
    expect(waiting.nextCardId).toBeNull();
    expect(waiting.nextDueAt).toBe(NOW + 2 * MIN);
    expect(waiting.counts.learning).toBe(2); // still counted as left to study, so the UI can say "waiting"
    expect(queue(NOW + 2 * MIN).nextCardId).toBe(sooner); // ...and it appears at its due time
    expect(queue(NOW + 2 * MIN - 1).nextCardId).toBeNull();
  });

  it('reports "done" with the next due time', () => {
    const due = Date.UTC(2026, 5, 12, 4);
    addCard(root, 'review', due);
    const q = queue();
    expect(q.nextCardId).toBeNull();
    expect(q.nextDueAt).toBe(due);
  });

  it('reports null next due time for an empty folder', () => {
    expect(queue().nextDueAt).toBeNull();
  });

  it('counts new (limited), learning and due review cards', () => {
    for (let i = 0; i < 25; i++) addCard(root, 'new', 0, i);
    addCard(root, 'learning', NOW + MIN);
    addCard(root, 'review', NOW - MIN);
    addCard(root, 'review', NOW + 86_400_000);
    expect(queue().counts).toEqual({ new: 20, learning: 1, review: 1 });
  });
});

describe('daily new card limit', () => {
  it('stops introducing new cards after the limit and resets at 4am', () => {
    const limited = addFolder(userId, null, 3);
    for (let i = 0; i < 5; i++) addCard(limited, 'new', 0, i);

    for (let i = 0; i < 3; i++) {
      const q = queue(NOW, limited);
      expect(q.counts.new).toBe(3 - i);
      rate(q.nextCardId!, 4, NOW); // Easy: graduate straight away so learning cards don't interfere
    }
    const done = queue(NOW, limited);
    expect(done.counts.new).toBe(0);
    expect(done.nextCardId).toBeNull();
    // New cards remain, so the next due time is the next 4am.
    expect(done.nextDueAt).toBe(Date.UTC(2026, 5, 11, 4));

    // 3:59am the next morning: still the same study day.
    expect(queue(Date.UTC(2026, 5, 11, 3, 59), limited).counts.new).toBe(0);
    // 4:00am: the limit resets.
    expect(queue(Date.UTC(2026, 5, 11, 4, 0), limited).counts.new).toBe(2);
  });

  it('uses the default limit of 20 when the folder has none', () => {
    for (let i = 0; i < 30; i++) addCard(root, 'new', 0, i);
    expect(queue().counts.new).toBe(20);
  });

  it('counts learning cards from today against the limit', () => {
    const limited = addFolder(userId, null, 2);
    const a = addCard(limited, 'new', 0, 1);
    addCard(limited, 'new', 0, 2);
    addCard(limited, 'new', 0, 3);
    rate(a, 3, NOW); // now learning
    expect(queue(NOW, limited).counts).toEqual({ new: 1, learning: 1, review: 0 });
  });
});

describe('after a folder reset', () => {
  it("cards that were reset do not count against today's new-card limit", () => {
    const limited = addFolder(userId, null, 2);
    const ids = [1, 2, 3].map((i) => addCard(limited, 'new', 0, i));
    rate(ids[0], 4, NOW);
    rate(ids[1], 4, NOW);
    expect(queue(NOW, limited).counts.new).toBe(0); // limit reached

    db.prepare(
      "UPDATE cards SET state='new', ease=2.5, interval_days=0, step=0, lapses=0, last_reviewed_at=NULL WHERE folder_id=?",
    ).run(limited);
    expect(queue(NOW, limited).counts.new).toBe(2); // fresh start: 2 of the 3 cards are allowed again
    expect(queue(NOW, limited).nextCardId).toBe(ids[0]);
  });
});

describe('user isolation in the queue', () => {
  it("never returns another user's cards or folders", () => {
    const theirs = addFolder(otherUserId, null);
    addCard(theirs, 'review', NOW - MIN, 0, otherUserId);
    // Their folder id, queried as us: nothing.
    expect(queue(NOW, theirs).nextCardId).toBeNull();
    // Their card placed in our folder id but owned by them: nothing.
    addCard(root, 'review', NOW - MIN, 0, otherUserId);
    expect(queue().nextCardId).toBeNull();
  });
});

describe('HTTP API', () => {
  let base: string;
  let server: ReturnType<ReturnType<typeof createApp>['listen']>;
  let uploads: string;
  let apiDb: DB;

  beforeAll(async () => {
    apiDb = openDb(':memory:');
    uploads = fs.mkdtempSync(path.join(os.tmpdir(), 'flashcards-test-'));
    server = createApp(apiDb, { uploadsDir: uploads }).listen(0);
    await new Promise((r) => server.once('listening', r));
    base = `http://localhost:${(server.address() as AddressInfo).port}/api`;
  });
  afterAll(() => {
    server.close();
    fs.rmSync(uploads, { recursive: true, force: true });
  });

  async function signup(email: string) {
    const res = await fetch(`${base}/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'correct horse', timezone: 'Europe/London' }),
    });
    expect(res.status).toBe(201);
    return res.headers.get('set-cookie')!.split(';')[0];
  }
  const call = (cookie: string, url: string, method = 'GET', body?: unknown) =>
    fetch(`${base}${url}`, {
      method,
      headers: { cookie, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });

  it('requires login', async () => {
    expect((await fetch(`${base}/folders`)).status).toBe(401);
  });

  it('rejects bad sign-ups and logins', async () => {
    const short = await fetch(`${base}/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'x@example.com', password: 'short' }),
    });
    expect(short.status).toBe(400);
    await signup('dupe@example.com');
    const dupe = await fetch(`${base}/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'DUPE@example.com', password: 'correct horse' }),
    });
    expect(dupe.status).toBe(409);
    const wrong = await fetch(`${base}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'dupe@example.com', password: 'wrong password' }),
    });
    expect(wrong.status).toBe(401);
    const right = await fetch(`${base}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'Dupe@Example.com', password: 'correct horse' }),
    });
    expect(right.status).toBe(200);
  });

  it("exports all of a user's cards as escaped CSV, and only their own", async () => {
    const carol = await signup('carol@example.com');
    const dave = await signup('dave@example.com');
    const { folder } = await (await call(carol, '/folders', 'POST', { name: 'Spanish' })).json();
    const { folder: sub } = await (await call(carol, '/folders', 'POST', { name: 'Verbs, basics', parent_id: folder.id })).json();
    await call(carol, `/folders/${folder.id}/cards`, 'POST', { front: 'hola', back: 'hello' });
    await call(carol, `/folders/${sub.id}/cards`, 'POST', { front: 'say "eat"', back: 'comer\nto eat' });
    const { folder: theirs } = await (await call(dave, '/folders', 'POST', { name: 'Secret' })).json();
    await call(dave, `/folders/${theirs.id}/cards`, 'POST', { front: 'dave only', back: 'private' });

    expect((await fetch(`${base}/export.csv`)).status).toBe(401);
    const res = await call(carol, '/export.csv');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
    expect(res.headers.get('content-disposition')).toMatch(/attachment; filename="georgie-flashcards-\d{4}-\d{2}-\d{2}\.csv"/);
    const bytes = new Uint8Array(await res.clone().arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]); // BOM, so Excel reads accents correctly
    const text = await res.text(); // decoding strips the BOM
    expect(text.startsWith('Folder,Front,Back\r\n')).toBe(true);
    expect(text).toContain('Spanish,hola,hello\r\n');
    expect(text).toContain('"Spanish / Verbs, basics","say ""eat""","comer\nto eat"\r\n');
    expect(text).not.toContain('dave only');
  });

  it('lists a folder and its subfolders for browsing: own cards first, then subfolders A-Z, oldest first', async () => {
    const gina = await signup('gina@example.com');
    const hank = await signup('hank@example.com');
    const mk = async (name: string, parent?: number) =>
      (await (await call(gina, '/folders', 'POST', { name, parent_id: parent })).json()).folder.id as number;
    const top = await mk('Top');
    const zebra = await mk('Zebra', top);
    const apple = await mk('Apple', top);
    const appleChild = await mk('Core', apple);
    const add = async (folder: number, front: string) => {
      await call(gina, `/folders/${folder}/cards`, 'POST', { front, back: '-' });
      await new Promise((r) => setTimeout(r, 3)); // distinct created_at
    };
    await add(zebra, 'z1');
    await add(top, 'top1');
    await add(appleChild, 'core1');
    await add(apple, 'apple1');
    await add(top, 'top2');
    await add(apple, 'apple2');

    const fronts = async (cookie: string, id: number) =>
      ((await (await call(cookie, `/folders/${id}/cards?deep=1`)).json()).cards as { front: string }[]).map((c) => c.front);
    expect(await fronts(gina, top)).toEqual(['top1', 'top2', 'apple1', 'apple2', 'core1', 'z1']);
    expect(await fronts(gina, apple)).toEqual(['apple1', 'apple2', 'core1']);
    // Not your folder: 404, and never leaks cards.
    expect((await call(hank, `/folders/${top}/cards?deep=1`)).status).toBe(404);
  });

  it('resets progress for a folder and its subfolders only, keeps the review history, and is private', async () => {
    const erin = await signup('erin@example.com');
    const frank = await signup('frank@example.com');
    const { folder: a } = await (await call(erin, '/folders', 'POST', { name: 'A' })).json();
    const { folder: aSub } = await (await call(erin, '/folders', 'POST', { name: 'A1', parent_id: a.id })).json();
    const { folder: b } = await (await call(erin, '/folders', 'POST', { name: 'B' })).json();
    const makeCard = async (folderId: number, front: string) =>
      (await (await call(erin, `/folders/${folderId}/cards`, 'POST', { front, back: 'x' })).json()).card.id as number;
    const cardA = await makeCard(a.id, 'a');
    const cardSub = await makeCard(aSub.id, 'a1');
    const cardB = await makeCard(b.id, 'b');
    for (const [id, studyFolder] of [[cardA, a.id], [cardSub, a.id], [cardB, b.id]]) {
      await call(erin, `/study/${studyFolder}/rate`, 'POST', { cardId: id, rating: 4 }); // Easy -> review
    }
    type Row = { state: string; interval_days: number; lapses: number; last_reviewed_at: number | null };
    const rowOf = (id: number) =>
      apiDb.prepare('SELECT state, interval_days, lapses, last_reviewed_at FROM cards WHERE id = ?').get(id) as Row;
    const logCount = () => (apiDb.prepare('SELECT COUNT(*) AS n FROM review_log').get() as { n: number }).n;
    expect(rowOf(cardA).state).toBe('review');
    const logBefore = logCount();

    // Another user can't reset it.
    expect((await call(frank, `/folders/${a.id}/reset`, 'POST')).status).toBe(404);
    expect(rowOf(cardA).state).toBe('review');

    const res = await call(erin, `/folders/${a.id}/reset`, 'POST');
    expect(res.status).toBe(200);
    expect((await res.json()).reset).toBe(2);
    expect(rowOf(cardA)).toMatchObject({ state: 'new', interval_days: 0, lapses: 0, last_reviewed_at: null });
    expect(rowOf(cardSub).state).toBe('new');
    expect(rowOf(cardB).state).toBe('review'); // a different folder is untouched
    expect(logCount()).toBe(logBefore); // history is kept

    const next = await (await call(erin, `/study/${a.id}/next`)).json();
    expect(next.done).toBe(false);
    expect(next.counts.new).toBe(2);
  });

  it('keeps each user’s folders, cards and images private, and studies end to end', async () => {
    const alice = await signup('alice@example.com');
    const bob = await signup('bob@example.com');

    const { folder } = await (await call(alice, '/folders', 'POST', { name: 'Biology' })).json();
    const { folder: sub } = await (await call(alice, '/folders', 'POST', { name: 'Cells', parent_id: folder.id })).json();
    const { card } = await (await call(alice, `/folders/${sub.id}/cards`, 'POST', { front: 'Mitochondria?', back: 'Powerhouse' })).json();

    const form = new FormData();
    form.append('side', 'back');
    form.append('images', new Blob([Buffer.from('89504e470d0a1a0a', 'hex')], { type: 'image/png' }), 'cell.png');
    const up = await fetch(`${base}/cards/${card.id}/images`, { method: 'POST', headers: { cookie: alice }, body: form });
    expect(up.status).toBe(201);
    const imageId = (await up.json()).card.images[0].id;

    // Bob sees nothing of Alice's.
    expect((await (await call(bob, '/folders')).json()).folders).toEqual([]);
    expect((await call(bob, `/folders/${sub.id}/cards`)).status).toBe(404);
    expect((await call(bob, `/images/${imageId}`)).status).toBe(404);
    expect((await call(bob, `/cards/${card.id}`, 'PATCH', { front: 'hacked' })).status).toBe(404);
    expect((await call(bob, `/cards/${card.id}`, 'DELETE')).status).toBe(404);
    expect((await call(bob, `/study/${folder.id}/next`)).status).toBe(404);
    expect((await call(bob, '/folders', 'POST', { name: 'x', parent_id: folder.id })).status).toBe(404);
    expect((await call(alice, `/images/${imageId}`)).status).toBe(200);

    // Alice studies the parent folder and gets the subfolder's card.
    const next = await (await call(alice, `/study/${folder.id}/next`)).json();
    expect(next.done).toBe(false);
    expect(next.card.id).toBe(card.id);
    expect(next.counts).toEqual({ new: 1, learning: 0, review: 0 });

    const after = await (await call(alice, `/study/${folder.id}/rate`, 'POST', { cardId: card.id, rating: 3 })).json();
    // Good on a new card -> 10 minute step. It's the only card, so there's nothing to show until it's due.
    expect(after.done).toBe(true);
    expect(after.counts).toEqual({ new: 0, learning: 1, review: 0 });
    expect(Math.round((after.nextDueAt - Date.now()) / 60_000)).toBe(10);
    const stored = apiDb.prepare('SELECT state, step FROM cards WHERE id = ?').get(card.id);
    expect(stored).toMatchObject({ state: 'learning', step: 1 });

    const log = apiDb.prepare('SELECT * FROM review_log WHERE card_id = ?').all(card.id);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ rating: 3, state_before: 'new', interval_before: 0, interval_after: 0, ease_after: 2.5 });
    expect(() => apiDb.prepare('UPDATE review_log SET rating = 1').run()).toThrow(/insert-only/);

    // A folder can't be moved into its own subfolder.
    expect((await call(alice, `/folders/${folder.id}`, 'PATCH', { parent_id: sub.id })).status).toBe(400);

    // Deleting the parent folder removes the subfolder, card and image file.
    expect((await call(alice, `/folders/${folder.id}`, 'DELETE')).status).toBe(200);
    expect((await (await call(alice, '/folders')).json()).folders).toEqual([]);
    expect((await call(alice, `/images/${imageId}`)).status).toBe(404);
  });
});
