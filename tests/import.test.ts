import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { openDb, type DB } from '../server/db';
import { commitImport, dryRunImport, type ImportItem, type ImportOptions } from '../server/importer';
import { createApp } from '../server/app';

let db: DB;
let uploads: string;
const user = { id: 0, timezone: 'UTC' };
let otherUser: number;

beforeEach(() => {
  db = openDb(':memory:');
  uploads = fs.mkdtempSync(path.join(os.tmpdir(), 'flashcards-import-'));
  user.id = Number(db.prepare("INSERT INTO users (email, password_hash, created_at) VALUES ('a@example.com', 'x', 0)").run().lastInsertRowid);
  otherUser = Number(db.prepare("INSERT INTO users (email, password_hash, created_at) VALUES ('b@example.com', 'x', 0)").run().lastInsertRowid);
});

const card = (front: string, back: string, ...p: string[]): ImportItem => ({ path: p, front, back });
const opts = (o: Partial<ImportOptions> = {}): ImportOptions & { uploadsDir: string } => ({
  destination: { type: 'new', name: 'Imported' },
  rebuildFolders: true,
  skipDuplicates: true,
  uploadsDir: uploads,
  ...o,
});
const count = (table: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
const folderPaths = () => {
  const rows = db.prepare('SELECT id, parent_id, name FROM folders').all() as { id: number; parent_id: number | null; name: string }[];
  const byId = new Map(rows.map((r) => [r.id, r]));
  const pathOf = (id: number): string => {
    const f = byId.get(id)!;
    return f.parent_id ? `${pathOf(f.parent_id)} / ${f.name}` : f.name;
  };
  return rows.map((r) => pathOf(r.id)).sort();
};

describe('what an import would do (dry run)', () => {
  it('reports the folders and cards without changing anything', () => {
    const s = dryRunImport(db, user.id, [card('a', 'b', 'Bio'), card('c', 'd', 'Bio', 'Cells'), card('e', 'f')], opts());
    expect(s).toMatchObject({ imported: 3, duplicates: 0, foldersCreated: 3, newFolderPaths: ['Imported', 'Imported / Bio', 'Imported / Bio / Cells'] });
    expect(count('folders')).toBe(0);
    expect(count('cards')).toBe(0);
  });
});

describe('importing', () => {
  it('creates the destination and rebuilds the folder structure, cards start as new, in file order', () => {
    const items = [card('one', '1', 'Bio'), card('two', '2', 'Bio', 'Cells'), card('three', '3', 'Bio'), card('four', '4')];
    const s = commitImport(db, user, items, opts());
    expect(s).toMatchObject({ imported: 4, foldersCreated: 3 });
    expect(folderPaths()).toEqual(['Imported', 'Imported / Bio', 'Imported / Bio / Cells']);

    const rows = db
      .prepare(
        `SELECT c.front, c.state, c.ease, c.interval_days, c.lapses, f.name AS folder FROM cards c JOIN folders f ON f.id = c.folder_id ORDER BY c.created_at, c.id`,
      )
      .all() as { front: string; state: string; ease: number; interval_days: number; lapses: number; folder: string }[];
    expect(rows.map((r) => [r.front, r.folder])).toEqual([['one', 'Bio'], ['two', 'Cells'], ['three', 'Bio'], ['four', 'Imported']]);
    expect(rows.every((r) => r.state === 'new' && r.ease === 2.5 && r.interval_days === 0 && r.lapses === 0)).toBe(true);
    expect(db.prepare('SELECT COUNT(*) AS n FROM cards WHERE user_id = ?').get(user.id)).toEqual({ n: 4 });
  });

  it("without 'rebuild folders', everything goes straight into the destination", () => {
    commitImport(db, user, [card('a', 'b', 'Bio'), card('c', 'd', 'Chem', 'Org')], opts({ rebuildFolders: false }));
    expect(folderPaths()).toEqual(['Imported']);
    expect(count('cards')).toBe(2);
  });

  it('adds to an existing folder and reuses subfolders that already exist (any capitalisation)', () => {
    const top = Number(db.prepare("INSERT INTO folders (user_id, name, created_at) VALUES (?, 'Science', 0)").run(user.id).lastInsertRowid);
    db.prepare("INSERT INTO folders (user_id, parent_id, name, created_at) VALUES (?, ?, 'Biology', 0)").run(user.id, top);
    commitImport(db, user, [card('a', 'b', 'biology'), card('c', 'd', 'Chemistry')], opts({ destination: { type: 'existing', folderId: top } }));
    expect(folderPaths()).toEqual(['Science', 'Science / Biology', 'Science / Chemistry']); // no second "Biology"
  });

  it('can create the new destination inside another folder', () => {
    const top = Number(db.prepare("INSERT INTO folders (user_id, name, created_at) VALUES (?, 'School', 0)").run(user.id).lastInsertRowid);
    commitImport(db, user, [card('a', 'b')], opts({ destination: { type: 'new', name: 'Quizlet set', parentId: top } }));
    expect(folderPaths()).toEqual(['School', 'School / Quizlet set']);
  });

  it('skips cards that already exist in that folder, and repeats inside the file', () => {
    const dest = Number(db.prepare("INSERT INTO folders (user_id, name, created_at) VALUES (?, 'Spanish', 0)").run(user.id).lastInsertRowid);
    db.prepare("INSERT INTO cards (user_id, folder_id, front, back, created_at, updated_at, due_at) VALUES (?, ?, 'hola', 'hello', 0, 0, 0)").run(user.id, dest);
    const items = [card('hola', 'hello'), card(' hola ', 'hello '), card('adios', 'goodbye'), card('adios', 'goodbye')];
    const existing = opts({ destination: { type: 'existing', folderId: dest } });

    expect(dryRunImport(db, user.id, items, existing)).toMatchObject({ imported: 1, duplicates: 3 });
    commitImport(db, user, items, existing);
    expect(count('cards')).toBe(2);

    // Importing the same file again adds nothing.
    expect(commitImport(db, user, items, existing)).toMatchObject({ imported: 0, duplicates: 4 });
    expect(count('cards')).toBe(2);
  });

  it('imports everything when duplicate-skipping is off', () => {
    commitImport(db, user, [card('a', 'b'), card('a', 'b')], opts({ skipDuplicates: false }));
    expect(count('cards')).toBe(2);
  });

  it("treats the same text in different folders as different cards", () => {
    commitImport(db, user, [card('a', 'b', 'X'), card('a', 'b', 'Y')], opts());
    expect(count('cards')).toBe(2);
  });

  it('skips rows with nothing in them', () => {
    expect(commitImport(db, user, [card('', ''), card('  ', ' '), card('a', '')], opts())).toMatchObject({ imported: 1, empty: 2 });
  });

  it('saves pictures with their cards', () => {
    const png = Buffer.from('89504e470d0a1a0a', 'hex');
    commitImport(db, user, [{ path: [], front: 'Name this', back: '', images: [{ side: 'front', ext: 'png', mime: 'image/png', data: png }] }], opts());
    const img = db.prepare('SELECT user_id, side, filename, mime FROM card_images').get() as { user_id: number; side: string; filename: string; mime: string };
    expect(img).toMatchObject({ user_id: user.id, side: 'front', mime: 'image/png' });
    expect(fs.readFileSync(path.join(uploads, String(user.id), img.filename))).toEqual(png);
  });

  it('is all-or-nothing: a failure part-way leaves no folders, cards or picture files behind', () => {
    const blocker = path.join(uploads, String(user.id)); // a FILE where the pictures folder should go
    fs.writeFileSync(blocker, 'x');
    const png = Buffer.from('89504e470d0a1a0a', 'hex');
    const items: ImportItem[] = [card('fine', 'card', 'Bio'), { path: ['Bio'], front: 'pic', back: '', images: [{ side: 'front', ext: 'png', mime: 'image/png', data: png }] }];
    expect(() => commitImport(db, user, items, opts())).toThrow();
    expect(count('folders')).toBe(0);
    expect(count('cards')).toBe(0);
    expect(count('card_images')).toBe(0);
  });

  it("will not import into, or under, another user's folder", () => {
    const theirs = Number(db.prepare("INSERT INTO folders (user_id, name, created_at) VALUES (?, 'Private', 0)").run(otherUser).lastInsertRowid);
    expect(() => commitImport(db, user, [card('a', 'b')], opts({ destination: { type: 'existing', folderId: theirs } }))).toThrow(/not found/i);
    expect(() => commitImport(db, user, [card('a', 'b')], opts({ destination: { type: 'new', name: 'x', parentId: theirs } }))).toThrow(/not found/i);
    expect(() => dryRunImport(db, user.id, [card('a', 'b')], opts({ destination: { type: 'existing', folderId: theirs } }))).toThrow(/not found/i);
    expect(count('cards')).toBe(0);
  });

  it('does not count duplicates against another user, who might have the same cards', () => {
    const theirs = Number(db.prepare("INSERT INTO folders (user_id, name, created_at) VALUES (?, 'Imported', 0)").run(otherUser).lastInsertRowid);
    db.prepare("INSERT INTO cards (user_id, folder_id, front, back, created_at, updated_at, due_at) VALUES (?, ?, 'a', 'b', 0, 0, 0)").run(otherUser, theirs);
    expect(commitImport(db, user, [card('a', 'b')], opts())).toMatchObject({ imported: 1, duplicates: 0 });
  });

  it('needs a folder name and refuses absurdly large imports', () => {
    expect(() => commitImport(db, user, [card('a', 'b')], opts({ destination: { type: 'new', name: '   ' } }))).toThrow(/name/i);
    const many = Array.from({ length: 20_001 }, (_, i) => card(`q${i}`, 'a'));
    expect(() => dryRunImport(db, user.id, many, opts())).toThrow(/too many/i);
  });

  it('copes with a big import quickly', () => {
    const many = Array.from({ length: 20_000 }, (_, i) => card(`question ${i}`, `answer ${i}`, `Folder ${i % 50}`));
    const t0 = Date.now();
    expect(commitImport(db, user, many, opts())).toMatchObject({ imported: 20_000, foldersCreated: 51 });
    expect(Date.now() - t0).toBeLessThan(5000);
    expect(count('cards')).toBe(20_000);
  });
});

describe('import over HTTP', () => {
  let server: ReturnType<ReturnType<typeof createApp>['listen']>;
  let base: string;
  let apiDb: DB;

  beforeAll(async () => {
    apiDb = openDb(':memory:');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flashcards-import-http-'));
    server = createApp(apiDb, { uploadsDir: path.join(dir, 'uploads') }).listen(0);
    await new Promise((r) => server.once('listening', r));
    base = `http://localhost:${(server.address() as AddressInfo).port}/api`;
  });
  afterAll(() => server.close());

  async function signup(email: string) {
    const res = await fetch(`${base}/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'correct horse' }),
    });
    return res.headers.get('set-cookie')!.split(';')[0];
  }
  const post = (cookie: string, url: string, body: unknown) =>
    fetch(`${base}${url}`, { method: 'POST', headers: { cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  it('requires login', async () => {
    const res = await fetch(`${base}/import`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    expect(res.status).toBe(401);
  });

  it('validates the request', async () => {
    const cookie = await signup('v@example.com');
    expect((await post(cookie, '/import', { cards: [] })).status).toBe(400);
    const tooLong = { destination: { type: 'new', name: 'x' }, rebuildFolders: true, skipDuplicates: true, cards: [{ path: [], front: 'x'.repeat(20_001), back: '' }] };
    expect((await post(cookie, '/import', tooLong)).status).toBe(400);
    const tooDeep = { ...tooLong, cards: [{ path: ['1', '2', '3', '4', '5', '6', '7'], front: 'x', back: '' }] };
    expect((await post(cookie, '/import', tooDeep)).status).toBe(400);
  });

  it('accepts a file far bigger than the normal 1 MB request limit, and the rest of the API still enforces it', async () => {
    const cookie = await signup('big@example.com');
    const cards = Array.from({ length: 4000 }, (_, i) => ({ path: [], front: `question ${i} ${'x'.repeat(400)}`, back: `answer ${i} ${'y'.repeat(400)}` }));
    const body = { destination: { type: 'new', name: 'Big' }, rebuildFolders: false, skipDuplicates: true, cards };
    expect(JSON.stringify(body).length).toBeGreaterThan(3_000_000);
    const res = await post(cookie, '/import', body);
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ imported: 4000 });

    const huge = { name: 'x'.repeat(2_000_000) };
    expect((await post(cookie, '/folders', huge)).status).toBeGreaterThanOrEqual(400); // normal routes keep the 1 MB cap
  });

  it('dry-run then import, end to end, and the cards belong to the right user', async () => {
    const cookie = await signup('e2e@example.com');
    const other = await signup('other@example.com');
    const body = {
      destination: { type: 'new', name: 'My Anki deck' },
      rebuildFolders: true,
      skipDuplicates: true,
      cards: [{ path: ['Bio'], front: 'Q1', back: 'A1' }, { path: ['Bio'], front: 'Q1', back: 'A1' }, { path: [], front: 'Q2', back: 'A2' }],
    };
    expect(await (await post(cookie, '/import/dry-run', body)).json()).toMatchObject({ imported: 2, duplicates: 1, foldersCreated: 2 });
    const done = await (await post(cookie, '/import', body)).json();
    expect(done).toMatchObject({ imported: 2, duplicates: 1 });

    const folders = (await (await fetch(`${base}/folders`, { headers: { cookie } })).json()).folders as { name: string; card_count: number }[];
    expect(folders.find((f) => f.name === 'My Anki deck')?.card_count).toBe(2);
    expect((await (await fetch(`${base}/folders`, { headers: { cookie: other } })).json()).folders).toEqual([]);
    // The other user can't import into it.
    expect((await post(other, '/import', { ...body, destination: { type: 'existing', folderId: done.folderId } })).status).toBe(404);
  });
});
