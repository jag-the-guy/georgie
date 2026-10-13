import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { openDb, type DB } from '../server/db';
import { createApp } from '../server/app';
import { buildApkg, JPG, PNG, type FixtureNote } from './apkgFixture';

const notes: FixtureNote[] = [
  { type: 'basic', fields: ['Capital of France?', 'Paris'], deck: 'Geography::Europe' },
  { type: 'basic', fields: ['Name this <img src="flag.png">', 'France'], deck: 'Geography::Europe' },
  { type: 'basic', fields: ['Capital of Japan?', 'Tokyo <img src="map.jpg">'], deck: 'Geography::Asia' },
  { type: 'cloze', fields: ['{{c1::Canberra}} is the capital of Australia.', ''], deck: 'Geography::Oceania' },
];

describe('importing an Anki deck over HTTP', () => {
  let server: ReturnType<ReturnType<typeof createApp>['listen']>;
  let base: string;
  let db: DB;
  let dir: string;

  beforeAll(async () => {
    db = openDb(':memory:');
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flashcards-apkg-http-'));
    server = createApp(db, { uploadsDir: path.join(dir, 'uploads'), stagingDir: path.join(dir, 'staging') }).listen(0);
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
  const upload = (cookie: string, bytes: Uint8Array, name = 'Geography.apkg') => {
    const form = new FormData();
    form.append('file', new Blob([Buffer.from(bytes)]), name);
    return fetch(`${base}/import/apkg/analyze`, { method: 'POST', headers: { cookie }, body: form });
  };
  const stagedFiles = () => (fs.existsSync(path.join(dir, 'staging')) ? fs.readdirSync(path.join(dir, 'staging')) : []);

  for (const latest of [false, true]) {
    it(`${latest ? 'newer' : 'older'} format: upload, preview, dry-run, import`, async () => {
      const cookie = await signup(`apkg-${latest}@example.com`);
      const res = await upload(cookie, buildApkg({ latest, notes, media: { 'flag.png': PNG, 'map.jpg': JPG } }));
      expect(res.status).toBe(201);
      const a = await res.json();
      expect(a).toMatchObject({ format: latest ? 'newer Anki format' : 'older Anki format', noteCount: 4, mediaCount: 2, commonRoot: 'Geography', suggestedName: 'Geography' });
      expect(a.noteTypes.map((t: { name: string }) => t.name)).toEqual(['Basic', 'Cloze']);
      expect(a.mappings).toEqual({ '1001': { front: 0, back: 1 }, '1002': { front: 0, back: 1 } });
      expect(stagedFiles().length).toBeGreaterThan(0);

      const settings = { token: a.token, mappings: a.mappings, stripCommonRoot: true };
      const preview = await (await post(cookie, '/import/apkg/preview', settings)).json();
      expect(preview.samples).toHaveLength(3);
      const withPictures = preview.samples.find((s: { frontImages: string[] }) => s.frontImages.length > 0);
      expect(withPictures.frontImages[0]).toMatch(/^data:image\/png;base64,/);
      expect(preview.stats).toMatchObject({ notes: 4, images: 2, cloze: 1 });
      expect((await (await post(cookie, '/import/apkg/preview', { ...settings, shift: 3 })).json()).samples).toHaveLength(3);

      const options = { destination: { type: 'new', name: 'Geography' }, rebuildFolders: true, skipDuplicates: true };
      const dry = await (await post(cookie, '/import/apkg/dry-run', { ...settings, options })).json();
      expect(dry).toMatchObject({ imported: 4, images: 2, newFolderPaths: ['Geography', 'Geography / Europe', 'Geography / Asia', 'Geography / Oceania'] });
      expect((await (await fetch(`${base}/folders`, { headers: { cookie } })).json()).folders).toEqual([]); // a dry run saves nothing

      const done = await post(cookie, '/import/apkg/commit', { ...settings, options });
      expect(done.status).toBe(201);
      expect(await done.json()).toMatchObject({ imported: 4, images: 2, foldersCreated: 4 });

      const folders = (await (await fetch(`${base}/folders`, { headers: { cookie } })).json()).folders as { name: string; card_count: number }[];
      expect(folders.find((f) => f.name === 'Europe')?.card_count).toBe(2);
      const europe = folders.find((f) => f.name === 'Europe') as unknown as { id: number };
      const cards = (await (await fetch(`${base}/folders/${europe.id}/cards`, { headers: { cookie } })).json()).cards as { front: string; images: { id: number; side: string }[] }[];
      const flag = cards.find((c) => c.front === 'Name this')!;
      expect(flag.images.map((i) => i.side)).toEqual(['front']);
      const img = await fetch(`${base}/images/${flag.images[0].id}`, { headers: { cookie } });
      expect(img.status).toBe(200);
      expect(img.headers.get('content-type')).toBe('image/png');
      expect(Buffer.from(await img.arrayBuffer())).toEqual(Buffer.from(PNG));

      // The upload is single-use: it's removed once imported.
      expect((await post(cookie, '/import/apkg/commit', { ...settings, options })).status).toBe(404);
    });
  }

  it("won't let someone else use your upload, and keeps staged files out of reach", async () => {
    const alice = await signup('alice-apkg@example.com');
    const mallory = await signup('mallory-apkg@example.com');
    const a = await (await upload(alice, buildApkg({ latest: false, notes }))).json();
    const settings = { token: a.token, mappings: a.mappings, stripCommonRoot: false };
    const options = { destination: { type: 'new', name: 'Stolen' }, rebuildFolders: true, skipDuplicates: true };
    expect((await post(mallory, '/import/apkg/preview', settings)).status).toBe(404);
    expect((await post(mallory, '/import/apkg/dry-run', { ...settings, options })).status).toBe(404);
    expect((await post(mallory, '/import/apkg/commit', { ...settings, options })).status).toBe(404);
    expect((await post(alice, '/import/apkg/preview', { ...settings, token: 'not-a-real-token' })).status).toBe(404);
    expect((await fetch(`${base}/import/apkg/analyze`, { method: 'POST' })).status).toBe(401);
  });

  it('keeps at most three uploads waiting per user, discarding the oldest', async () => {
    const cookie = await signup('hoarder-apkg@example.com');
    const other = await signup('bystander-apkg@example.com');
    const tokens: string[] = [];
    for (let i = 0; i < 5; i++) tokens.push((await (await upload(cookie, buildApkg({ latest: false, notes }))).json()).token);
    const otherToken = (await (await upload(other, buildApkg({ latest: false, notes }))).json()).token;
    const usable = async (c: string, token: string) =>
      (await post(c, '/import/apkg/preview', { token, mappings: {}, stripCommonRoot: false })).status === 200;
    expect(await Promise.all(tokens.map((t) => usable(cookie, t)))).toEqual([false, false, true, true, true]);
    expect(await usable(other, otherToken)).toBe(true); // someone else's upload is unaffected
  });

  it('rejects files that are not Anki decks, and keeps nothing', async () => {
    const cookie = await signup('bad-apkg@example.com');
    const before = stagedFiles().length;
    const res = await upload(cookie, new TextEncoder().encode('not a deck'), 'cats.apkg');
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/Anki deck file/);
    expect(stagedFiles().length).toBe(before); // the rejected upload was deleted
    expect((await fetch(`${base}/import/apkg/analyze`, { method: 'POST', headers: { cookie } })).status).toBe(400); // no file at all
  });

  it('applies the chosen field mapping and destination settings', async () => {
    const cookie = await signup('mapping-apkg@example.com');
    const a = await (await upload(cookie, buildApkg({ latest: true, notes: notes.slice(0, 1), media: {} }))).json();
    const swapped = { token: a.token, mappings: { '1001': { front: 1, back: 0 } }, stripCommonRoot: false };
    const options = { destination: { type: 'new', name: 'Flipped' }, rebuildFolders: false, skipDuplicates: true };
    const done = await (await post(cookie, '/import/apkg/commit', { ...swapped, options })).json();
    expect(done).toMatchObject({ imported: 1, foldersCreated: 1 });
    const row = db.prepare("SELECT c.front, c.back FROM cards c JOIN folders f ON f.id = c.folder_id WHERE f.name = 'Flipped'").get();
    expect(row).toEqual({ front: 'Paris', back: 'Capital of France?' });
  });
});
