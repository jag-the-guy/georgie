import Database from 'better-sqlite3';
import { zipSync } from 'fflate';
import zlib from 'node:zlib';

/** Smallest valid-looking files of each picture type (only the signature matters to Georgie). */
export const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
export const JPG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]);
export const SVG = Uint8Array.from(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'));

export interface FixtureNote {
  type: 'basic' | 'cloze' | 'vocab';
  fields: string[];
  /** Deck name using Anki's "::" for sub-decks. */
  deck: string;
}

const TYPES = {
  basic: { id: 1001, name: 'Basic', fields: ['Front', 'Back'], cloze: false },
  cloze: { id: 1002, name: 'Cloze', fields: ['Text', 'Back Extra'], cloze: true },
  vocab: { id: 1003, name: 'Japanese vocab', fields: ['Kanji', 'Reading', 'Meaning'], cloze: false },
};

const varint = (n: number): number[] => {
  const out: number[] = [];
  do {
    let b = n & 0x7f;
    n = Math.floor(n / 128);
    if (n > 0) b |= 0x80;
    out.push(b);
  } while (n > 0);
  return out;
};
const lenDelimited = (field: number, bytes: Uint8Array) => [...varint(field * 8 + 2), ...varint(bytes.length), ...bytes];

/** Anki's MediaEntries protobuf: repeated entries, each with name (1), size (2), sha1 (3). */
export function mediaEntriesProto(names: string[]): Uint8Array {
  const out: number[] = [];
  for (const name of names) {
    const entry = [...lenDelimited(1, Buffer.from(name)), ...varint(2 * 8), ...varint(123), ...lenDelimited(3, new Uint8Array(20))];
    out.push(...lenDelimited(1, Uint8Array.from(entry)));
  }
  return Uint8Array.from(out);
}

/** Builds an .apkg the way Anki does, in the older (plain SQLite) or newer (zstd, schema 18) layout. */
export function buildApkg(opts: { latest: boolean; notes: FixtureNote[]; media?: Record<string, Uint8Array> }): Uint8Array {
  const db = new Database(':memory:');
  const usedTypes = [...new Set(opts.notes.map((n) => n.type))].map((t) => TYPES[t]);
  const deckNames = [...new Set(opts.notes.map((n) => n.deck))];
  const deckId = (name: string) => 2000 + deckNames.indexOf(name);

  if (opts.latest) {
    // Names use Anki's custom "unicase" sort order, which plain SQLite can't create: write "nocase" and patch it below.
    db.exec(`
      CREATE TABLE notetypes (id integer NOT NULL PRIMARY KEY, name text NOT NULL COLLATE nocase , mtime_secs integer NOT NULL, usn integer NOT NULL, config blob NOT NULL);
      CREATE UNIQUE INDEX idx_notetypes_name ON notetypes (name);
      CREATE TABLE fields (ntid integer NOT NULL, ord integer NOT NULL, name text NOT NULL COLLATE nocase , config blob NOT NULL, PRIMARY KEY (ntid, ord)) without rowid;
      CREATE UNIQUE INDEX idx_fields_name_ntid ON fields (name, ntid);
      CREATE TABLE decks (id integer PRIMARY KEY NOT NULL, name text NOT NULL COLLATE nocase , mtime_secs integer NOT NULL, usn integer NOT NULL, common blob NOT NULL, kind blob NOT NULL);
      CREATE UNIQUE INDEX idx_decks_name ON decks (name);
    `);
    for (const t of usedTypes) {
      db.prepare('INSERT INTO notetypes VALUES (?, ?, 0, 0, x\'\')').run(t.id, t.name);
      t.fields.forEach((f, ord) => db.prepare("INSERT INTO fields VALUES (?, ?, ?, x'')").run(t.id, ord, f));
    }
    for (const d of deckNames) db.prepare("INSERT INTO decks VALUES (?, ?, 0, 0, x'', x'')").run(deckId(d), d.split('::').join('\x1f'));
  } else {
    const models: Record<string, unknown> = {};
    for (const t of usedTypes) models[t.id] = { name: t.name, type: t.cloze ? 1 : 0, flds: t.fields.map((name, ord) => ({ name, ord })) };
    const decks: Record<string, unknown> = {};
    for (const d of deckNames) decks[deckId(d)] = { name: d };
    db.exec(`CREATE TABLE col (id integer primary key, crt integer not null, mod integer not null, scm integer not null, ver integer not null, dty integer not null, usn integer not null, ls integer not null, conf text not null, models text not null, decks text not null, dconf text not null, tags text not null)`);
    db.prepare("INSERT INTO col VALUES (1, 0, 0, 0, 11, 0, 0, 0, '{}', ?, ?, '{}', '{}')").run(JSON.stringify(models), JSON.stringify(decks));
  }
  db.exec(`
    CREATE TABLE notes (id integer primary key, guid text not null, mid integer not null, mod integer not null, usn integer not null, tags text not null, flds text not null, sfld integer not null, csum integer not null, flags integer not null, data text not null);
    CREATE TABLE cards (id integer primary key, nid integer not null, did integer not null, ord integer not null, mod integer not null, usn integer not null, type integer not null, queue integer not null, due integer not null, ivl integer not null, factor integer not null, reps integer not null, lapses integer not null, left integer not null, odue integer not null, odid integer not null, flags integer not null, data text not null);
  `);
  opts.notes.forEach((n, i) => {
    const nid = 5000 + i;
    db.prepare("INSERT INTO notes VALUES (?, ?, ?, 0, 0, '', ?, 0, 0, 0, '')").run(nid, `g${i}`, TYPES[n.type].id, n.fields.join('\x1f'));
    db.prepare('INSERT INTO cards VALUES (?, ?, ?, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, \'\')').run(9000 + i, nid, deckId(n.deck));
  });

  let dbBytes: Uint8Array = db.serialize();
  db.close();
  if (opts.latest) {
    const buf = Buffer.from(dbBytes);
    const from = Buffer.from('COLLATE nocase ');
    const to = Buffer.from('COLLATE unicase');
    for (let at = buf.indexOf(from); at !== -1; at = buf.indexOf(from, at + 1)) to.copy(buf, at);
    dbBytes = zlib.zstdCompressSync(buf);
  }

  const mediaNames = Object.keys(opts.media ?? {});
  const files: Record<string, Uint8Array> = {};
  if (opts.latest) {
    files['meta'] = Uint8Array.from([0x08, 0x03]); // PackageMetadata { version = 3 }
    files['collection.anki21b'] = dbBytes;
    files['media'] = zlib.zstdCompressSync(mediaEntriesProto(mediaNames));
    mediaNames.forEach((name, i) => (files[String(i)] = zlib.zstdCompressSync(opts.media![name])));
  } else {
    files['collection.anki2'] = dbBytes;
    files['media'] = Buffer.from(JSON.stringify(Object.fromEntries(mediaNames.map((n, i) => [String(i), n]))));
    mediaNames.forEach((name, i) => (files[String(i)] = opts.media![name]));
  }
  return zipSync(files);
}
