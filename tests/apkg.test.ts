import { beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { zipSync } from 'fflate';
import Database from 'better-sqlite3';
import { buildApkgItems, defaultMappings, parseMediaEntries, readApkg, sniffImage } from '../server/apkg';
import { commitImport } from '../server/importer';
import { openDb, type DB } from '../server/db';
import { HttpError } from '../server/http';
import { buildApkg, JPG, mediaEntriesProto, PNG, SVG, type FixtureNote } from './apkgFixture';

const notes: FixtureNote[] = [
  { type: 'basic', fields: ['What is the powerhouse of the cell?', 'The <b>mitochondrion</b><br>(makes ATP)'], deck: 'Biology::Cells' },
  { type: 'basic', fields: ['Name this: <img src="heart.png">', 'The heart <img src="my%20lung.jpg"> and <img src="gone.png">'], deck: 'Biology' },
  { type: 'cloze', fields: ['The {{c1::nucleus}} stores {{c2::DNA::molecule}}.', 'Found in eukaryotes'], deck: 'Biology::Cells' },
  { type: 'vocab', fields: ['犬', 'いぬ', 'dog [sound:inu.mp3]<img src="logo.svg">'], deck: 'Default' },
];
const media = { 'heart.png': PNG, 'my lung.jpg': JPG, 'logo.svg': SVG };

for (const latest of [false, true]) {
  describe(`reading an ${latest ? 'newer (zstd, schema 18)' : 'older (plain SQLite)'} Anki deck`, () => {
    const pkg = () => readApkg(buildApkg({ latest, notes, media }));

    it('finds the note types, with field names, counts and examples', () => {
      const p = pkg();
      expect(p.format).toBe(latest ? 'newer Anki format' : 'older Anki format');
      expect(p.noteTypes.map((t) => [t.name, t.count, t.cloze])).toEqual([['Basic', 2, false], ['Cloze', 1, true], ['Japanese vocab', 1, false]]);
      expect(p.noteTypes[0].fields).toEqual(['Front', 'Back']);
      expect(p.noteTypes[0].examples[0]).toBe('What is the powerhouse of the cell?');
      expect(p.noteTypes[2].fields).toEqual(['Kanji', 'Reading', 'Meaning']);
    });

    it('chooses sensible front/back fields for each note type', () => {
      const p = pkg();
      expect(defaultMappings(p)).toEqual({ '1001': { front: 0, back: 1 }, '1002': { front: 0, back: 1 }, '1003': { front: 0, back: 2 } });
    });

    it('turns notes into cards: clean text, cloze, deck folders, "Default" deck means no folder', () => {
      const p = pkg();
      const { items, stats } = buildApkgItems(p, defaultMappings(p));
      expect(items).toHaveLength(4);
      expect(items[0]).toMatchObject({ path: ['Biology', 'Cells'], front: 'What is the powerhouse of the cell?', back: 'The mitochondrion\n(makes ATP)' });
      expect(items[2]).toMatchObject({ path: ['Biology', 'Cells'], front: 'The […] stores [molecule].', back: 'The nucleus stores DNA.\n\nFound in eukaryotes' });
      expect(items[3]).toMatchObject({ path: [], front: '犬', back: 'dog' });
      expect(stats).toMatchObject({ notes: 4, cloze: 1, audio: 1 });
    });

    it('attaches pictures to the right side, handling %20 names, and counts missing / unsupported ones', () => {
      const p = pkg();
      const { items, stats } = buildApkgItems(p, defaultMappings(p));
      expect(items[1].images?.map((i) => [i.side, i.ext, i.mime])).toEqual([['front', 'png', 'image/png'], ['back', 'jpg', 'image/jpeg']]);
      expect(Buffer.from(items[1].images![0].data)).toEqual(Buffer.from(PNG));
      expect(items[1].front).toBe('Name this:');
      expect(stats).toMatchObject({ images: 2, missingMedia: 1, unsupportedMedia: 1 }); // gone.png is absent; logo.svg can't be shown
    });

    it('lets the user swap front and back, or drop the back', () => {
      const p = pkg();
      const swapped = buildApkgItems(p, { ...defaultMappings(p), '1001': { front: 1, back: 0 } }).items;
      expect(swapped[0]).toMatchObject({ front: 'The mitochondrion\n(makes ATP)', back: 'What is the powerhouse of the cell?' });
      const noBack = buildApkgItems(p, { ...defaultMappings(p), '1001': { front: 0, back: null } }).items;
      expect(noBack[0]).toMatchObject({ front: 'What is the powerhouse of the cell?', back: '' });
    });

    it('detects a shared top-level deck, and can drop it from the paths', () => {
      const p = pkg();
      expect(p.commonRoot).toBeNull(); // the Default-deck note has no deck, so there is no single root
      const oneDeck = readApkg(buildApkg({ latest, notes: notes.slice(0, 3), media }));
      expect(oneDeck.commonRoot).toBe('Biology');
      const items = buildApkgItems(oneDeck, defaultMappings(oneDeck), { stripCommonRoot: true }).items;
      expect(items.map((i) => i.path)).toEqual([['Cells'], [], ['Cells']]);
      expect(oneDeck.decks).toEqual([{ path: 'Biology', count: 1 }, { path: 'Biology / Cells', count: 2 }]);
    });
  });
}

describe('importing a deck into Georgie, end to end', () => {
  let db: DB;
  let uploads: string;
  beforeEach(() => {
    db = openDb(':memory:');
    uploads = fs.mkdtempSync(path.join(os.tmpdir(), 'flashcards-apkg-'));
    db.prepare("INSERT INTO users (email, password_hash, created_at) VALUES ('a@example.com', 'x', 0)").run();
  });

  it('creates folders, cards and picture files', () => {
    const p = readApkg(buildApkg({ latest: true, notes, media }));
    const { items, stats } = buildApkgItems(p, defaultMappings(p));
    const result = commitImport(db, { id: 1, timezone: 'UTC' }, items, { destination: { type: 'new', name: 'My deck' }, rebuildFolders: true, skipDuplicates: true, uploadsDir: uploads });
    expect(result).toMatchObject({ imported: 4, images: stats.images, foldersCreated: 3 }); // My deck, Biology, Biology / Cells (the Default-deck note goes in My deck itself)
    const imgs = db.prepare("SELECT i.side, i.filename, i.mime, c.front FROM card_images i JOIN cards c ON c.id = i.card_id ORDER BY i.id").all() as { side: string; filename: string; mime: string; front: string }[];
    expect(imgs.map((i) => [i.side, i.mime])).toEqual([['front', 'image/png'], ['back', 'image/jpeg']]);
    expect(fs.readFileSync(path.join(uploads, '1', imgs[0].filename))).toEqual(Buffer.from(PNG));
  });
});

describe('bad files are refused with a clear message', () => {
  const message = (fn: () => unknown) => {
    try {
      fn();
    } catch (e) {
      expect(e).toBeInstanceOf(HttpError);
      expect((e as HttpError).status).toBe(400);
      return (e as HttpError).message;
    }
    throw new Error('expected an error');
  };

  it('not a zip at all', () => {
    expect(message(() => readApkg(new TextEncoder().encode('just some text, not a deck')))).toMatch(/Anki deck file/);
  });
  it('a zip with no Anki collection in it', () => {
    expect(message(() => readApkg(zipSync({ 'readme.txt': new TextEncoder().encode('hi') })))).toMatch(/no Anki collection/);
  });
  it('a collection that is not a database', () => {
    expect(message(() => readApkg(zipSync({ 'collection.anki2': new TextEncoder().encode('this is not sqlite') })))).toMatch(/couldn't be (read|understood)/);
  });
  it('a newer-format collection that is not compressed', () => {
    expect(message(() => readApkg(zipSync({ 'collection.anki21b': new Uint8Array(100) })))).toMatch(/damaged/);
  });
  it('a crafted database whose "notes" is a view instead of a real table', () => {
    const db = new Database(':memory:');
    db.exec(`CREATE TABLE col (id integer primary key, models text, decks text);
             CREATE TABLE cards (id integer primary key, nid integer, did integer, odid integer);
             CREATE VIEW notes AS WITH RECURSIVE r(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM r) SELECT n AS id, 1 AS mid, 'x' AS flds FROM r;`);
    const bytes = db.serialize();
    expect(message(() => readApkg(zipSync({ 'collection.anki2': bytes })))).toMatch(/missing the notes table/);
  });
  it('a database that is not an Anki collection', () => {
    const empty = zipSync({ 'collection.anki2': new Uint8Array(0) });
    expect(message(() => readApkg(empty))).toMatch(/couldn't be (read|understood)/);
  });
});

describe('the pieces', () => {
  it('reads Anki\'s media list, including long names and unknown fields', () => {
    const long = 'x'.repeat(200) + '.png'; // length needs a two-byte varint
    expect(parseMediaEntries(mediaEntriesProto(['a.png', long, 'ü ñ.jpg']))).toEqual(['a.png', long, 'ü ñ.jpg']);
    expect(parseMediaEntries(new Uint8Array(0))).toEqual([]);
  });
  it('recognises pictures by their contents, not their names', () => {
    expect(sniffImage(PNG)?.ext).toBe('png');
    expect(sniffImage(JPG)?.ext).toBe('jpg');
    expect(sniffImage(Uint8Array.from(Buffer.from('GIF89a......')))?.ext).toBe('gif');
    expect(sniffImage(Uint8Array.from(Buffer.from('RIFF....WEBPVP8 ')))?.ext).toBe('webp');
    expect(sniffImage(SVG)).toBeNull();
    expect(sniffImage(new TextEncoder().encode('<script>alert(1)</script>.png'))).toBeNull();
  });
});
