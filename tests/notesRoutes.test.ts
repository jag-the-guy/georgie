import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { openDb, type DB } from '../server/db';
import { createApp } from '../server/app';
import { DemoGenerator } from '../server/notes/demo';
import { NotesError, type CardGenerator, type GenerateRequest, type GenerateResult } from '../server/notes/types';
import { PNG } from './apkgFixture';

/** A stand-in for the AI that the test controls: it waits until told to finish (or fail). */
class FakeAi implements CardGenerator {
  mode = 'claude' as const;
  model = 'claude-opus-5-5';
  requests: GenerateRequest[] = [];
  private release: (() => void) | null = null;
  private fail: Error | null = null;
  hold = false;

  result: GenerateResult = {
    mode: 'claude',
    model: this.model,
    subject: 'Biology: cells',
    summary: 'About cells.',
    warnings: [],
    topics: [
      { name: 'Organelles', cards: [{ front: 'Powerhouse of the cell?', back: 'The mitochondrion' }, { front: 'Where is DNA stored?', back: 'The nucleus' }] },
      { name: 'Membranes', cards: [{ front: 'What does the cell membrane do?', back: 'Controls what enters and leaves.' }] },
    ],
  };

  async generate(req: GenerateRequest): Promise<GenerateResult> {
    this.requests.push(req);
    req.onProgress({ stage: 'Writing flashcards…', cards: 2 });
    if (this.hold) {
      await new Promise<void>((resolve, reject) => {
        this.release = resolve;
        req.signal.addEventListener('abort', () => reject(new NotesError('Cancelled.', 499)), { once: true });
      });
    }
    if (this.fail) throw this.fail;
    return this.result;
  }
  finish() {
    this.release?.();
  }
  failWith(e: Error | null) {
    this.fail = e;
  }
  reset() {
    this.hold = false;
    this.fail = null;
    this.release = null;
    this.requests = [];
  }
}

describe('turning notes into flashcards over HTTP', () => {
  let server: ReturnType<ReturnType<typeof createApp>['listen']>;
  let base: string;
  let db: DB;
  const ai = new FakeAi();
  let allowedEmails = new Set<string>();
  let limit = 5;
  let clock = Date.UTC(2026, 9, 13, 12);

  beforeAll(async () => {
    db = openDb(':memory:');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flashcards-notes-'));
    server = createApp(db, {
      uploadsDir: path.join(dir, 'uploads'),
      notes: { generator: ai, allowed: (u) => allowedEmails.has(u.email), dailyLimit: limit, now: () => clock },
    }).listen(0);
    await new Promise((r) => server.once('listening', r));
    base = `http://localhost:${(server.address() as AddressInfo).port}/api`;
  });
  afterAll(() => server.close());
  beforeEach(() => {
    ai.reset();
    clock = Date.UTC(2026, 9, 13, 12);
    db.prepare('DELETE FROM ai_usage').run();
  });

  async function signup(email: string) {
    const res = await fetch(`${base}/auth/signup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'correct horse' }) });
    allowedEmails.add(email);
    return res.headers.get('set-cookie')!.split(';')[0];
  }
  const get = (cookie: string, url: string) => fetch(`${base}${url}`, { headers: { cookie } });
  const form = (fields: Record<string, string>, files: [string, Uint8Array | string][] = []) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(fields)) f.append(k, v);
    for (const [name, data] of files) f.append('files', new Blob([typeof data === 'string' ? data : Buffer.from(data)]), name);
    return f;
  };
  const generate = (cookie: string, fields: Record<string, string> = { text: 'Some notes about cells.' }, files: [string, Uint8Array | string][] = []) =>
    fetch(`${base}/notes/generate`, { method: 'POST', headers: { cookie }, body: form(fields, files) });
  const wait = async (cookie: string, jobId: string, until = (s: string) => s !== 'working') => {
    for (let i = 0; i < 100; i++) {
      const body = await (await get(cookie, `/notes/jobs/${jobId}`)).json();
      if (until(body.status)) return body;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error('job did not finish');
  };

  it('requires login', async () => {
    expect((await fetch(`${base}/notes/status`)).status).toBe(401);
    expect((await fetch(`${base}/notes/generate`, { method: 'POST' })).status).toBe(401);
  });

  it('is switched off for people who are not allowed: hidden, and every route refuses', async () => {
    const cookie = await signup('stranger@example.com');
    allowedEmails.delete('stranger@example.com');
    expect(await (await get(cookie, '/notes/status')).json()).toEqual({ available: false });
    expect((await generate(cookie)).status).toBe(403);
    expect((await get(cookie, '/notes/jobs/abc')).status).toBe(403);
    expect(ai.requests).toHaveLength(0);
    expect((db.prepare('SELECT COUNT(*) AS n FROM ai_usage').get() as { n: number }).n).toBe(0);
  });

  it('tells an allowed person what is available', async () => {
    const cookie = await signup('owner@example.com');
    expect(await (await get(cookie, '/notes/status')).json()).toMatchObject({
      available: true,
      mode: 'claude',
      model: 'claude-opus-5-5',
      dailyLimit: 5,
      usedToday: 0,
      limits: { maxFiles: 6, maxImageMB: 5 },
    });
  });

  it('makes cards from pasted notes and uploaded files, passing the options through', async () => {
    const cookie = await signup('maker@example.com');
    const res = await generate(cookie, { text: 'Pasted notes', density: 'thorough', focus: 'formulas' }, [
      ['Biología.txt', 'The nucleus stores DNA.'],
      ['picture.png', PNG],
    ]);
    expect(res.status).toBe(202);
    const { jobId } = await res.json();
    const done = await wait(cookie, jobId);
    expect(done.status).toBe('done');
    expect(done.result).toMatchObject({ subject: 'Biology: cells', mode: 'claude' });
    expect(done.result.topics.map((t: { name: string }) => t.name)).toEqual(['Organelles', 'Membranes']);
    expect(done.cards).toBe(3);

    const req = ai.requests[0];
    expect(req.options).toEqual({ density: 'thorough', focus: 'formulas' });
    expect(req.parts.map((p) => [p.kind, p.name])).toEqual([['text', 'Biología.txt'], ['image', 'picture.png'], ['text', 'Pasted notes']]);
    expect(await (await get(cookie, '/notes/status')).json()).toMatchObject({ usedToday: 1 });
  });

  it('shows progress while the AI is working', async () => {
    const cookie = await signup('patient@example.com');
    ai.hold = true;
    const { jobId } = await (await generate(cookie)).json();
    const working = await wait(cookie, jobId, () => true);
    expect(working).toMatchObject({ status: 'working', stage: 'Writing flashcards…', cards: 2 });
    expect(working.result).toBeUndefined();
    ai.finish();
    expect((await wait(cookie, jobId)).status).toBe('done');
  });

  it('allows one job at a time per person', async () => {
    const cookie = await signup('busy@example.com');
    ai.hold = true;
    const first = await (await generate(cookie)).json();
    const second = await generate(cookie);
    expect(second.status).toBe(409);
    expect((await second.json()).error).toMatch(/still working/);
    ai.finish();
    await wait(cookie, first.jobId);
    expect((await generate(cookie)).status).toBe(202); // free again once it has finished
  });

  it('validates the request before spending anything', async () => {
    const cookie = await signup('careful@example.com');
    const check = async (res: Response, status: number, text: RegExp) => {
      expect(res.status).toBe(status);
      expect((await res.json()).error).toMatch(text);
    };
    await check(await generate(cookie, {}), 400, /Add some notes first/);
    await check(await generate(cookie, { text: 'x', density: 'extreme' }), 400, /density/);
    await check(await generate(cookie, { text: 'x', focus: 'y'.repeat(501) }), 400, /focus/);
    await check(await generate(cookie, {}, [['a.bin', new Uint8Array([1, 0, 2, 0, 3])]]), 400, /isn't a file type/);
    await check(await generate(cookie, {}, Array.from({ length: 7 }, (_, i) => [`f${i}.txt`, 'x'] as [string, string])), 400, /files or fewer/);
    expect(ai.requests).toHaveLength(0);
    expect(await (await get(cookie, '/notes/status')).json()).toMatchObject({ usedToday: 0 }); // rejected requests cost no go
  });

  it('keeps jobs private to the person who started them', async () => {
    const alice = await signup('alice-notes@example.com');
    const bob = await signup('bob-notes@example.com');
    ai.hold = true;
    const { jobId } = await (await generate(alice)).json();
    expect((await get(bob, `/notes/jobs/${jobId}`)).status).toBe(404);
    await fetch(`${base}/notes/jobs/${jobId}`, { method: 'DELETE', headers: { cookie: bob } }); // bob cannot cancel it
    expect((await wait(alice, jobId, () => true)).status).toBe('working');
    ai.finish();
    expect((await wait(alice, jobId)).status).toBe('done');
    expect((await get(alice, '/notes/jobs/not-a-real-job')).status).toBe(404);
  });

  it('can be cancelled, and a cancelled job does not use up a go', async () => {
    const cookie = await signup('canceller@example.com');
    ai.hold = true;
    const { jobId } = await (await generate(cookie)).json();
    expect(await (await get(cookie, '/notes/status')).json()).toMatchObject({ usedToday: 1 });
    await fetch(`${base}/notes/jobs/${jobId}`, { method: 'DELETE', headers: { cookie } });
    const job = await wait(cookie, jobId);
    expect(job.status).toBe('cancelled');
    expect(await (await get(cookie, '/notes/status')).json()).toMatchObject({ usedToday: 0 });
  });

  it('reports failures kindly and gives the go back', async () => {
    const cookie = await signup('unlucky@example.com');
    ai.failWith(new NotesError('The AI is busy right now. Please wait a minute and try again.', 503));
    const { jobId } = await (await generate(cookie)).json();
    const job = await wait(cookie, jobId);
    expect(job).toMatchObject({ status: 'error', error: 'The AI is busy right now. Please wait a minute and try again.' });
    expect(job.result).toBeUndefined();
    expect(await (await get(cookie, '/notes/status')).json()).toMatchObject({ usedToday: 0 });

    const spy = (await import('vitest')).vi.spyOn(console, 'error').mockImplementation(() => {});
    ai.failWith(new Error('TypeError: cannot read property of secret internals'));
    const second = await wait(cookie, (await (await generate(cookie)).json()).jobId);
    expect(second.error).toBe('Something went wrong while making the flashcards. Please try again.');
    expect(JSON.stringify(second)).not.toMatch(/secret/);
    spy.mockRestore();
  });

  it('stops at the daily limit, and starts afresh the next day', async () => {
    const cookie = await signup('keen@example.com');
    for (let i = 0; i < 5; i++) await wait(cookie, (await (await generate(cookie)).json()).jobId);
    const sixth = await generate(cookie);
    expect(sixth.status).toBe(429);
    expect((await sixth.json()).error).toMatch(/used all 5 of today's goes/);
    expect(ai.requests).toHaveLength(5);
    clock += 24 * 3_600_000;
    expect((await generate(cookie)).status).toBe(202);
  });

  it('the cards can then be imported into folders, one subfolder per topic', async () => {
    const cookie = await signup('importer-notes@example.com');
    const done = await wait(cookie, (await (await generate(cookie)).json()).jobId);
    const cards = done.result.topics.flatMap((t: { name: string; cards: { front: string; back: string }[] }) => t.cards.map((c) => ({ path: [t.name], ...c })));
    const body = { destination: { type: 'new', name: done.result.subject }, rebuildFolders: true, skipDuplicates: true, cards };
    const post = (url: string) => fetch(`${base}${url}`, { method: 'POST', headers: { cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    expect(await (await post('/import/dry-run')).json()).toMatchObject({ imported: 3, foldersCreated: 3 });
    expect((await post('/import')).status).toBe(201);
    const folders = (await (await get(cookie, '/folders')).json()).folders as { name: string; card_count: number }[];
    expect(folders.map((f) => `${f.name}:${f.card_count}`).sort()).toEqual(['Biology: cells:3', 'Membranes:1', 'Organelles:2']);
  });
});

describe('with the demo generator (no AI key)', () => {
  it('works end to end, labelled clearly as a demo', async () => {
    const db = openDb(':memory:');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flashcards-demo-'));
    const server = createApp(db, { uploadsDir: path.join(dir, 'uploads'), notes: { generator: new DemoGenerator(1), allowed: () => true, dailyLimit: 3 } }).listen(0);
    await new Promise((r) => server.once('listening', r));
    const base = `http://localhost:${(server.address() as AddressInfo).port}/api`;
    const signup = await fetch(`${base}/auth/signup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'demo-user@example.com', password: 'correct horse' }) });
    const cookie = signup.headers.get('set-cookie')!.split(';')[0];
    expect(await (await fetch(`${base}/notes/status`, { headers: { cookie } })).json()).toMatchObject({ available: true, mode: 'demo', model: null });

    const f = new FormData();
    f.append('text', '# Cells\nMitochondrion: the organelle that makes ATP for the cell.');
    const { jobId } = await (await fetch(`${base}/notes/generate`, { method: 'POST', headers: { cookie }, body: f })).json();
    let job;
    for (let i = 0; i < 100; i++) {
      job = await (await fetch(`${base}/notes/jobs/${jobId}`, { headers: { cookie } })).json();
      if (job.status !== 'working') break;
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(job.status).toBe('done');
    expect(job.result.mode).toBe('demo');
    expect(job.result.warnings[0]).toMatch(/Demo mode/);
    server.close();
  });

  it('is switched off by default when the app is set up without it', async () => {
    const db = openDb(':memory:');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flashcards-off-'));
    const server = createApp(db, { uploadsDir: path.join(dir, 'uploads') }).listen(0);
    await new Promise((r) => server.once('listening', r));
    const base = `http://localhost:${(server.address() as AddressInfo).port}/api`;
    const signup = await fetch(`${base}/auth/signup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'nobody@example.com', password: 'correct horse' }) });
    const cookie = signup.headers.get('set-cookie')!.split(';')[0];
    expect(await (await fetch(`${base}/notes/status`, { headers: { cookie } })).json()).toEqual({ available: false });
    server.close();
  });
});
