import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { openDb } from '../server/db';
import { createApp } from '../server/app';
import { buildCards, parseImportText } from '../shared/importParse';

describe('exporting chosen folders', () => {
  let server: ReturnType<ReturnType<typeof createApp>['listen']>;
  let base: string;
  let alice: string;
  let bob: string;
  const ids: Record<string, number> = {};

  const call = (cookie: string, url: string, method = 'GET', body?: unknown) =>
    fetch(`${base}${url}`, { method, headers: { cookie, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const signup = async (email: string) => {
    const res = await fetch(`${base}/auth/signup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'correct horse' }) });
    return res.headers.get('set-cookie')!.split(';')[0];
  };
  const mkFolder = async (cookie: string, name: string, parent?: number) => (await (await call(cookie, '/folders', 'POST', { name, parent_id: parent })).json()).folder.id as number;
  const mkCard = (cookie: string, folder: number, front: string) => call(cookie, `/folders/${folder}/cards`, 'POST', { front, back: `back of ${front}` });
  const csv = async (cookie: string, query = '') => (await (await call(cookie, `/export.csv${query}`)).text()).replace(/^﻿/, '').trim().split('\r\n');

  beforeAll(async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flashcards-export-'));
    server = createApp(openDb(':memory:'), { uploadsDir: path.join(dir, 'uploads') }).listen(0);
    await new Promise((r) => server.once('listening', r));
    base = `http://localhost:${(server.address() as AddressInfo).port}/api`;
    alice = await signup('alice-export@example.com');
    bob = await signup('bob-export@example.com');

    ids.A = await mkFolder(alice, 'Alpha');
    ids.B = await mkFolder(alice, 'Beta', ids.A);
    ids.C = await mkFolder(alice, 'Gamma');
    await mkCard(alice, ids.A, 'a1');
    await mkCard(alice, ids.B, 'b1');
    await mkCard(alice, ids.B, 'b2');
    await mkCard(alice, ids.C, 'c1');
    ids.bobs = await mkFolder(bob, 'Secret');
    await mkCard(bob, ids.bobs, 'bob-only');
  });
  afterAll(() => server.close());

  it('with no choice, exports everything the user has (and nothing of anyone else)', async () => {
    const lines = await csv(alice);
    expect(lines).toHaveLength(5);
    expect(lines.join('\n')).not.toContain('bob-only');
  });

  it('exports only the chosen folders, and just their own cards (not subfolders unless chosen)', async () => {
    expect(await csv(alice, `?folders=${ids.A}`)).toEqual(['Folder,Front,Back', 'Alpha,a1,back of a1']);
    expect(await csv(alice, `?folders=${ids.A},${ids.B}`)).toEqual(['Folder,Front,Back', 'Alpha,a1,back of a1', 'Alpha / Beta,b1,back of b1', 'Alpha / Beta,b2,back of b2']);
    expect(await csv(alice, `?folders=${ids.C},${ids.B}`)).toEqual(['Folder,Front,Back', 'Alpha / Beta,b1,back of b1', 'Alpha / Beta,b2,back of b2', 'Gamma,c1,back of c1']);
  });

  it("never reveals another user's folder, even when its id is asked for", async () => {
    expect(await csv(alice, `?folders=${ids.bobs}`)).toEqual(['Folder,Front,Back']);
    expect((await csv(alice, `?folders=${ids.A},${ids.bobs}`)).join('\n')).not.toContain('bob-only');
    expect(await csv(bob, `?folders=${ids.A}`)).toEqual(['Folder,Front,Back']);
  });

  it('names the file differently for a selection', async () => {
    expect((await call(alice, '/export.csv')).headers.get('content-disposition')).toMatch(/georgie-flashcards-\d{4}/);
    expect((await call(alice, `/export.csv?folders=${ids.A}`)).headers.get('content-disposition')).toMatch(/georgie-flashcards-selected-\d{4}/);
  });

  it('rejects malformed folder lists', async () => {
    for (const bad of ['?folders=', '?folders=abc', '?folders=1,,2', '?folders=1;DROP TABLE cards', '?folders=-1', '?folders=1,2,']) {
      expect((await call(alice, `/export.csv${bad}`)).status, bad).toBe(400);
    }
  });

  it('copes with a long list of folders', async () => {
    const many = Array.from({ length: 2000 }, (_, i) => i + 1).join(',');
    expect((await csv(alice, `?folders=${many},${ids.C}`)).length).toBeGreaterThanOrEqual(2);
  });

  it('requires login', async () => {
    expect((await fetch(`${base}/export.csv?folders=1`)).status).toBe(401);
  });

  it("a selective export can be imported straight back into Georgie's importer", async () => {
    const text = (await csv(alice, `?folders=${ids.A},${ids.B}`)).join('\r\n');
    const table = parseImportText(text)!;
    expect(table.source).toBe('Georgie');
    expect(buildCards(table, table.mapping).cards.map((c) => [c.path.join('/'), c.front])).toEqual([['Alpha', 'a1'], ['Alpha/Beta', 'b1'], ['Alpha/Beta', 'b2']]);
  });
});
