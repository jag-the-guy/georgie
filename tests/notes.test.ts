import Anthropic from '@anthropic-ai/sdk';
import { zipSync } from 'fflate';
import { describe, expect, it, vi } from 'vitest';
import { openDb } from '../server/db';
import { loadDotEnv } from '../server/env';
import { readNotes } from '../server/notes/extract';
import { buildContent, ClaudeGenerator, explainApiError, type ClaudeClientLike } from '../server/notes/claude';
import { DemoGenerator } from '../server/notes/demo';
import { OUTPUT_SCHEMA, salvageTruncatedJson, SYSTEM_PROMPT, tidyGenerated } from '../server/notes/prompt';
import { refundQuota, takeQuota, usedToday } from '../server/notes/quota';
import { LIMITS, type GenerateRequest, type InputPart } from '../server/notes/types';
import { JPG, PNG } from './apkgFixture';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const enc = new TextEncoder();
const buf = (s: string) => Buffer.from(s);
const message = async (p: Promise<unknown>) => (await p.then(() => null, (e: Error) => e))?.message ?? null;

function docx(text: string): Buffer {
  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${text
    .split('\n')
    .map((line) => `<w:p><w:r><w:t>${line}</w:t></w:r></w:p>`)
    .join('')}</w:body></w:document>`;
  return Buffer.from(
    zipSync({
      '[Content_Types].xml': enc.encode(
        '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
      ),
      '_rels/.rels': enc.encode(
        '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
      ),
      'word/document.xml': enc.encode(xml),
    }),
  );
}

describe('reading uploaded notes', () => {
  it('needs something to read', async () => {
    expect(await message(readNotes([], '   '))).toMatch(/Add some notes first/);
  });

  it('accepts pasted text, text files and Markdown, recognised by contents not names', async () => {
    const parts = await readNotes([{ name: 'notes.md', buffer: buf('# Cells\nThe nucleus stores DNA.') }, { name: 'weird.xyz', buffer: buf('Plain text in a strangely named file') }], 'pasted bit');
    expect(parts.map((p) => [p.kind, p.name])).toEqual([['text', 'notes.md'], ['text', 'weird.xyz'], ['text', 'Pasted notes']]);
  });

  it('passes PDFs and pictures through untouched, using the real file type', async () => {
    const pdf = Buffer.concat([buf('%PDF-1.7\n'), Buffer.alloc(100, 1)]);
    const parts = await readNotes([{ name: 'lecture.pdf', buffer: pdf }, { name: 'page.jpg', buffer: Buffer.from(PNG) }, { name: 'photo.png', buffer: Buffer.from(JPG) }], '');
    expect(parts[0]).toMatchObject({ kind: 'pdf', name: 'lecture.pdf' });
    expect(parts[1]).toMatchObject({ kind: 'image', mime: 'image/png' }); // named .jpg but really a PNG
    expect(parts[2]).toMatchObject({ kind: 'image', mime: 'image/jpeg' });
  });

  it('reads Word documents', async () => {
    const parts = await readNotes([{ name: 'essay.docx', buffer: docx('Mitosis\nCell division making two identical cells.') }], '');
    expect(parts[0]).toMatchObject({ kind: 'text', name: 'essay.docx' });
    expect((parts[0] as { text: string }).text).toContain('Cell division making two identical cells.');
  });

  it('explains clearly what it cannot read', async () => {
    const heic = Buffer.concat([Buffer.alloc(4), buf('ftypheic'), Buffer.alloc(20)]);
    expect(await message(readNotes([{ name: 'IMG_1.HEIC', buffer: heic }], ''))).toMatch(/HEIC/);
    expect(await message(readNotes([{ name: 'a.rtf', buffer: buf('{\\rtf1\\ansi hello}') }], ''))).toMatch(/RTF/);
    expect(await message(readNotes([{ name: 'a.bin', buffer: Buffer.from([1, 2, 0, 3, 0, 0, 9]) }], ''))).toMatch(/isn't a file type/);
    expect(await message(readNotes([{ name: 'empty.txt', buffer: Buffer.alloc(0) }], ''))).toMatch(/empty/);
    expect(await message(readNotes([{ name: 'blank.txt', buffer: buf('  \n \n') }], ''))).toMatch(/no text/);
    const pptx = Buffer.from(zipSync({ 'ppt/presentation.xml': enc.encode('<x/>') }));
    expect(await message(readNotes([{ name: 'slides.pptx', buffer: pptx }], ''))).toMatch(/PowerPoint and Excel/);
    expect(await message(readNotes([{ name: 'broken.docx', buffer: buf('PK\u0003\u0004 definitely not a zip') }], ''))).toMatch(/couldn't be opened/);
    expect(await message(readNotes([{ name: 'empty.docx', buffer: docx('') }], ''))).toMatch(/no text/);
  });

  it('enforces limits with messages that say what to do', async () => {
    const files = Array.from({ length: LIMITS.maxFiles + 1 }, (_, i) => ({ name: `f${i}.txt`, buffer: buf('x') }));
    expect(await message(readNotes(files, ''))).toMatch(/files or fewer/);
    const bigImage = Buffer.concat([Buffer.from(PNG), Buffer.alloc(LIMITS.maxImageBytes + 10)]);
    expect(await message(readNotes([{ name: 'huge.png', buffer: bigImage }], ''))).toMatch(/at most 5 MB/);
    const pdf = Buffer.concat([buf('%PDF-'), Buffer.alloc(8 * 1024 * 1024)]);
    expect(await message(readNotes([1, 2, 3].map((i) => ({ name: `p${i}.pdf`, buffer: pdf })), ''))).toMatch(/add up to/);
    expect(await message(readNotes([], 'x'.repeat(LIMITS.maxTextChars + 1)))).toMatch(/lot of text/);
  });

  it('handles file names with accents', async () => {
    const parts = await readNotes([{ name: 'Biología — tema 1.txt', buffer: buf('hola') }], '');
    expect(parts[0].name).toBe('Biología — tema 1.txt');
  });
});

describe('tidying what the AI sends back', () => {
  const raw = (topics: unknown) => ({ subject: 'Biology', summary: 'Cells', topics });

  it('keeps good cards, in order, and removes empty ones and duplicates', () => {
    const { notes } = tidyGenerated(
      raw([
        { name: 'Cells', cards: [{ front: 'What is a cell?', back: 'The basic unit of life.' }, { front: ' ', back: 'x' }, { front: 'what is a cell?', back: 'the basic unit of life.' }, { front: 'Q2', back: '' }] },
        { name: 'Empty topic', cards: [] },
      ]),
    );
    expect(notes.topics).toHaveLength(1);
    expect(notes.topics[0].cards).toEqual([{ front: 'What is a cell?', back: 'The basic unit of life.' }]);
  });

  it('turns everything into plain text', () => {
    const { notes } = tidyGenerated(raw([{ name: '<b>Cells</b>', cards: [{ front: 'What is <i>DNA</i>?', back: 'A molecule<br>that stores <b>genes</b>.\u0000' }, { front: 'Is 3 < 5 and 7 > 2?', back: 'Yes' }] }]));
    expect(notes.topics[0].name).toBe('Cells');
    expect(notes.topics[0].cards[0]).toEqual({ front: 'What is DNA?', back: 'A molecule\nthat stores genes.' });
    expect(notes.topics[0].cards[1]).toEqual({ front: 'Is 3 < 5 and 7 > 2?', back: 'Yes' }); // maths is not mistaken for a tag
  });

  it('caps the number of cards', () => {
    const cards = Array.from({ length: LIMITS.maxCards + 50 }, (_, i) => ({ front: `q${i}`, back: `a${i}` }));
    const { notes, trimmed } = tidyGenerated(raw([{ name: 'Big', cards }]));
    expect(trimmed).toBe(true);
    expect(notes.topics[0].cards).toHaveLength(LIMITS.maxCards);
  });

  it('rejects answers in the wrong shape, or with nothing usable', () => {
    expect(() => tidyGenerated({ nonsense: true })).toThrow(/unexpected/);
    expect(() => tidyGenerated(raw([{ name: 'x', cards: [{ front: '', back: '' }] }]))).toThrow(/No flashcards could be made/);
  });

  it('rescues cards from an answer cut off partway', () => {
    const full = JSON.stringify(raw([{ name: 'A', cards: [{ front: 'q1', back: 'a1' }, { front: 'q2', back: 'a2' }, { front: 'q3', back: 'a3' }] }]));
    const cut = full.slice(0, full.indexOf('"q3"') + 6); // stops inside the third card
    const rescued = salvageTruncatedJson(cut) as { topics: { cards: unknown[] }[] };
    expect(rescued.topics[0].cards).toHaveLength(2);
    expect(salvageTruncatedJson('{"subject":"x","topics":[{"name":"A","cards":[{"fr')).toBeNull();
    expect(salvageTruncatedJson('complete nonsense')).toBeNull();
  });
});

describe('the request sent to the AI', () => {
  const okJson = JSON.stringify({ subject: 'Biology: cells', summary: 'About cells', topics: [{ name: 'Organelles', cards: [{ front: 'Powerhouse of the cell?', back: 'The mitochondrion' }] }] });
  const run = (parts: InputPart[], options = { density: 'standard' as const }, reply = { stop_reason: 'end_turn', text: okJson }, model?: string) => {
    const calls: { params: Record<string, any>; options?: { signal?: AbortSignal } }[] = [];
    const client: ClaudeClientLike = {
      beta: {
        messages: {
          stream: (params, options) => {
            calls.push({ params, options });
            let listener: (d: string, s: string) => void = () => {};
            return {
              on: (_e, l) => ((listener = l), undefined),
              finalMessage: async () => {
                listener(reply.text, reply.text);
                return { stop_reason: reply.stop_reason, content: [{ type: 'text', text: reply.text }], usage: { input_tokens: 1200, output_tokens: 340 } };
              },
            };
          },
        },
      },
    };
    const progress: { stage: string; cards?: number }[] = [];
    const req: GenerateRequest = { parts, options, signal: new AbortController().signal, onProgress: (p) => progress.push(p) };
    return { generator: new ClaudeGenerator({ client, model }), req, calls, progress };
  };

  it('uses the current model, structured output, adaptive thinking, and the refusal fallback', async () => {
    const { generator, req, calls } = run([{ kind: 'text', name: 'cells.txt', text: 'The mitochondrion makes ATP.' }]);
    await generator.generate(req);
    const p = calls[0].params;
    expect(p.model).toBe('claude-opus-5-5');
    expect(p.max_tokens).toBe(48_000);
    expect(p.thinking).toEqual({ type: 'adaptive' });
    expect(p.output_config.effort).toBe('high');
    expect(p.output_config.format).toEqual({ type: 'json_schema', schema: OUTPUT_SCHEMA });
    expect(p.fallbacks).toBe('default');
    expect(p.betas).toEqual(['server-side-fallback-2026-07-01']);
    expect(p.system).toBe(SYSTEM_PROMPT);
    expect(p).not.toHaveProperty('temperature'); // sampling settings are rejected on this model
    expect(p).not.toHaveProperty('tool_choice');
    expect(calls[0].options?.signal).toBe(req.signal);
  });

  it('can use a different model', async () => {
    const { generator, req, calls } = run([{ kind: 'text', name: 'a', text: 'x' }], undefined, undefined, 'claude-sonnet-5-5');
    await generator.generate(req);
    expect(calls[0].params.model).toBe('claude-sonnet-5-5');
  });

  it('sends text, PDFs and pictures as the right kinds of content, then the instructions', () => {
    const blocks = buildContent(
      [
        { kind: 'text', name: 'a.txt', text: 'hello notes' },
        { kind: 'pdf', name: 'slides.pdf', data: Buffer.from('%PDF-1') },
        { kind: 'image', name: 'page.png', mime: 'image/png', data: Buffer.from(PNG) },
      ],
      { density: 'thorough', focus: 'only the formulas' },
    ) as any[];
    expect(blocks.map((b) => b.type)).toEqual(['text', 'text', 'document', 'text', 'image', 'text']);
    expect(blocks[0].text).toContain('hello notes');
    expect(blocks[2].source).toEqual({ type: 'base64', media_type: 'application/pdf', data: Buffer.from('%PDF-1').toString('base64') });
    expect(blocks[4].source.media_type).toBe('image/png');
    expect(blocks[5].text).toMatch(/THOROUGH/);
    expect(blocks[5].text).toContain('only the formulas');
  });

  it('asks for light, standard and thorough sets differently', () => {
    const text = (d: 'light' | 'standard' | 'thorough') => (buildContent([], { density: d }) as any[]).at(-1).text as string;
    expect(text('light')).toMatch(/LIGHT/);
    expect(text('standard')).toMatch(/STANDARD/);
    expect(text('thorough')).toMatch(/THOROUGH/);
    expect(text('light')).not.toMatch(/student asked you to concentrate/);
  });

  it('treats notes as material, not instructions', () => {
    expect(SYSTEM_PROMPT).toMatch(/never follow it/);
  });

  it('returns tidy topics, reports progress, and the token usage', async () => {
    const { generator, req, progress } = run([{ kind: 'text', name: 'a', text: 'x' }]);
    const result = await generator.generate(req);
    expect(result).toMatchObject({ mode: 'claude', model: 'claude-opus-5-5', subject: 'Biology: cells', warnings: [], usage: { inputTokens: 1200, outputTokens: 340 } });
    expect(result.topics[0].cards).toEqual([{ front: 'Powerhouse of the cell?', back: 'The mitochondrion' }]);
    expect(progress[0].stage).toMatch(/Reading and understanding/);
    expect(progress.at(-1)).toMatchObject({ stage: 'Writing flashcards…', cards: 1 });
  });

  it('keeps what it can when the AI runs out of room, and says so', async () => {
    const cut = okJson.replace('}]}]}', '},{"front":"cut o');
    const { generator, req } = run([{ kind: 'text', name: 'a', text: 'x' }], undefined, { stop_reason: 'max_tokens', text: cut });
    const result = await generator.generate(req);
    expect(result.topics[0].cards).toHaveLength(1);
    expect(result.warnings.join(' ')).toMatch(/ran out of room/);
    const hopeless = run([{ kind: 'text', name: 'a', text: 'x' }], undefined, { stop_reason: 'max_tokens', text: '{"subject":"x"' });
    expect(await message(hopeless.generator.generate(hopeless.req))).toMatch(/too big/);
  });

  it('explains a refusal and bad replies', async () => {
    const refused = run([{ kind: 'text', name: 'a', text: 'x' }], undefined, { stop_reason: 'refusal', text: '' });
    expect(await message(refused.generator.generate(refused.req))).toMatch(/declined/);
    const junk = run([{ kind: 'text', name: 'a', text: 'x' }], undefined, { stop_reason: 'end_turn', text: 'not json' });
    expect(await message(junk.generator.generate(junk.req))).toMatch(/unexpected/);
  });
});

describe('explaining AI service errors', () => {
  const api = (status: number, text: string) =>
    Anthropic.APIError.generate(status, { type: 'error', error: { type: 'x', message: text } }, text, new Headers());
  it.each([
    [401, 'invalid x-api-key', /ANTHROPIC_API_KEY/],
    [403, 'forbidden', /isn't allowed to use this model/],
    [429, 'rate limited', /busy right now/],
    [400, 'Your credit balance is too low to access the Anthropic API', /run out of credit/],
    [400, 'prompt is too long: 250000 tokens > 200000 maximum', /too long/],
    [400, 'something odd about this file', /couldn't read one of the files/],
    [529, 'overloaded', /overloaded/],
    [500, 'oops', /overloaded/],
    [413, 'request too large', /too big/],
  ])('%i "%s"', (status, text, expected) => {
    const e = explainApiError(api(status, text));
    expect(e.message).toMatch(expected);
    expect(e.message).not.toMatch(/sk-ant|at Object|stack/i);
  });
  it('connection problems, cancellation, and the unexpected', () => {
    expect(explainApiError(new Anthropic.APIConnectionError({ message: 'ECONNRESET' })).message).toMatch(/Couldn't reach the AI/);
    const c = new AbortController();
    c.abort();
    expect(explainApiError(new Error('x'), c.signal).message).toBe('Cancelled.');
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(explainApiError(new Error('secret internals')).message).toMatch(/Something went wrong/);
    expect(explainApiError(new Error('secret internals')).message).not.toMatch(/secret/);
    spy.mockRestore();
  });
});

describe('the demo (used when no AI key is set)', () => {
  const gen = (parts: InputPart[], signal = new AbortController().signal) => {
    const progress: unknown[] = [];
    return { run: () => new DemoGenerator(1).generate({ parts, options: { density: 'standard' }, signal, onProgress: (p) => progress.push(p) }), progress };
  };
  const text = (t: string): InputPart[] => [{ kind: 'text', name: 'n.txt', text: t }];

  it('makes cards from "Term: definition" and "X is Y" lines, grouped under headings, and says it is a demo', async () => {
    const r = await gen(text('# Cells\nMitochondrion: the organelle that makes ATP for the cell.\nThe nucleus is the control centre that stores the DNA.\n\n# Genetics\n- DNA - the molecule that carries genetic information\n')).run();
    expect(r.mode).toBe('demo');
    expect(r.topics.map((t) => t.name)).toEqual(['Cells', 'Genetics']);
    expect(r.topics[0].cards[0]).toEqual({ front: 'What is Mitochondrion?', back: 'The organelle that makes ATP for the cell.' });
    expect(r.topics[0].cards[1].front).toBe('What is the nucleus?');
    expect(r.topics[1].cards[0].back).toMatch(/carries genetic information/);
    expect(r.warnings[0]).toMatch(/Demo mode.*not by real AI/);
    expect(r.subject).toBe('Cells');
  });
  it('gives placeholder cards for PDFs and pictures, which it cannot read', async () => {
    const r = await gen([{ kind: 'pdf', name: 'slides.pdf', data: Buffer.from('%PDF') }]).run();
    expect(r.topics[0].cards).toHaveLength(3);
    expect(r.warnings.join(' ')).toMatch(/can't read PDFs/);
  });
  it('falls back to passages when nothing matches, and fails kindly with nothing usable', async () => {
    const r = await gen(text('Here is a long paragraph that has no definitions in it at all but is long enough to be a passage.\n\nAnother lengthy paragraph, again with nothing that looks like a definition whatsoever, just prose.')).run();
    expect(r.topics[0].cards.length).toBeGreaterThan(0);
    expect(await message(gen(text('hi')).run())).toMatch(/could not find anything/);
  });
  it('stops when cancelled', async () => {
    const c = new AbortController();
    const p = new DemoGenerator(5000).generate({ parts: text('# A\nTerm: its definition goes here'), options: { density: 'light' }, signal: c.signal, onProgress: () => {} });
    c.abort();
    expect(await message(p)).toBe('Cancelled.');
  });
});

describe('the daily limit', () => {
  const setup = () => {
    const db = openDb(':memory:');
    const a = Number(db.prepare("INSERT INTO users (email, password_hash, created_at) VALUES ('a@x.com', 'x', 0)").run().lastInsertRowid);
    const b = Number(db.prepare("INSERT INTO users (email, password_hash, created_at) VALUES ('b@x.com', 'x', 0)").run().lastInsertRowid);
    return { db, a, b };
  };
  const day1 = Date.UTC(2026, 9, 13, 10);
  it('counts goes per person and stops at the limit', () => {
    const { db, a, b } = setup();
    expect([1, 2, 3].map(() => takeQuota(db, a, 3, day1))).toEqual([true, true, true]);
    expect(takeQuota(db, a, 3, day1)).toBe(false);
    expect(usedToday(db, a, day1)).toBe(3);
    expect(takeQuota(db, b, 3, day1)).toBe(true); // someone else's goes are separate
  });
  it('resets each day, and a refund gives a go back (but never below zero)', () => {
    const { db, a } = setup();
    takeQuota(db, a, 1, day1);
    expect(takeQuota(db, a, 1, day1)).toBe(false);
    expect(takeQuota(db, a, 1, day1 + 24 * 3_600_000)).toBe(true);
    refundQuota(db, a, day1);
    expect(takeQuota(db, a, 1, day1)).toBe(true);
    refundQuota(db, a, day1);
    refundQuota(db, a, day1);
    refundQuota(db, a, day1);
    expect(usedToday(db, a, day1)).toBe(0);
  });
  it('a limit of zero blocks everyone', () => {
    const { db, a } = setup();
    expect(takeQuota(db, a, 0, day1)).toBe(false);
  });
});

describe('the settings file', () => {
  it('loads KEY=value lines without overriding what is already set', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'env-')), '.env');
    fs.writeFileSync(file, '# a comment\nANTHROPIC_API_KEY=sk-test-123\nNOTES_AI_USERS="a@x.com, b@x.com"  \nexport EXTRA=1 # trailing\nEMPTY=\nALREADY=from-file\nnot a line\n');
    const env: NodeJS.ProcessEnv = { ALREADY: 'from-shell' };
    const loaded = loadDotEnv(file, env);
    expect(env).toMatchObject({ ANTHROPIC_API_KEY: 'sk-test-123', NOTES_AI_USERS: 'a@x.com, b@x.com', EXTRA: '1', ALREADY: 'from-shell' });
    expect(env.EMPTY).toBeUndefined();
    expect(loaded.sort()).toEqual(['ANTHROPIC_API_KEY', 'EXTRA', 'NOTES_AI_USERS']);
    expect(loadDotEnv(path.join(os.tmpdir(), 'does-not-exist.env'), {})).toEqual([]);
  });
});

