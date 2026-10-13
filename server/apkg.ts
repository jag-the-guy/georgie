/**
 * Reads Anki deck files (.apkg).
 *
 * An .apkg is a zip holding an SQLite database of notes plus the pictures/sounds. Two layouts exist:
 *  - older ("legacy"): collection.anki2 / collection.anki21, plain SQLite; `media` is a JSON map {"0": "cat.jpg"}
 *  - newer: collection.anki21b, the same database compressed with zstd; `media` is a zstd-compressed protobuf
 *    list of names, and media files are numbered by their position in that list (and also zstd-compressed).
 * Details checked against Anki's own source (rslib/src/import_export/package).
 */
import { unzipSync } from 'fflate';
import { Decompress } from 'fzstd';
import Database from 'better-sqlite3';
import { HttpError } from './http';
import { cleanField, hasCloze, MAX_FIELD_LENGTH, splitCloze, splitFolderPath } from '../shared/importParse';
import type { ImportImage, ImportItem } from './importer';

// Kept modest on purpose: a hostile file shouldn't be able to exhaust a small server's memory. The upload itself is
// capped at 50 MB, and real decks (already-compressed pictures plus a database) unpack to a few times that at most.
const MAX_ZIP_BYTES = 200 * 1024 * 1024; // everything once unzipped
const MAX_DB_BYTES = 150 * 1024 * 1024;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export interface ApkgNoteType {
  id: string;
  name: string;
  fields: string[];
  cloze: boolean;
  count: number;
  /** A short cleaned example of each field, to help the user pick. */
  examples: string[];
}

export interface ApkgNote {
  typeId: string;
  fields: string[];
  deck: string[];
}

export interface ApkgPackage {
  format: 'older Anki format' | 'newer Anki format';
  noteTypes: ApkgNoteType[];
  notes: ApkgNote[];
  decks: { path: string; count: number }[];
  /** When every note sits under one top-level deck (how Anki exports a deck), that deck's name. */
  commonRoot: string | null;
  /** Media file name -> contents. */
  media: Map<string, Uint8Array>;
}

export interface FieldMapping {
  front: number;
  /** null = nothing on the back. */
  back: number | null;
}
export type ApkgMappings = Record<string, FieldMapping>;

// ---------------------------------------------------------------------------------------------
// Low-level helpers
// ---------------------------------------------------------------------------------------------

const isZstd = (b: Uint8Array) => b.length > 4 && b[0] === 0x28 && b[1] === 0xb5 && b[2] === 0x2f && b[3] === 0xfd;

/** zstd-decompress, refusing anything that would expand beyond `limit` bytes (a "zip bomb" guard). */
function zstd(data: Uint8Array, limit: number): Uint8Array {
  const chunks: Uint8Array[] = [];
  let total = 0;
  const stream = new Decompress((chunk) => {
    total += chunk.length;
    if (total > limit) throw new HttpError(400, 'That Anki file expands to more data than Georgie can import.');
    chunks.push(chunk);
  });
  stream.push(data, true);
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

/** The names in Anki's protobuf `MediaEntries` message: repeated field 1, each holding a string name as its field 1. */
export function parseMediaEntries(buf: Uint8Array): string[] {
  const names: string[] = [];
  const varint = (pos: number): [number, number] => {
    let result = 0;
    let shift = 0;
    for (;;) {
      if (pos >= buf.length) throw new Error('truncated');
      const b = buf[pos++];
      result += (b & 0x7f) * 2 ** shift;
      if (!(b & 0x80)) return [result, pos];
      shift += 7;
    }
  };
  let pos = 0;
  while (pos < buf.length) {
    let tag: number;
    [tag, pos] = varint(pos);
    const field = Math.floor(tag / 8);
    const wire = tag & 7;
    if (wire === 2) {
      let len: number;
      [len, pos] = varint(pos);
      if (field === 1) names.push(readEntryName(buf.subarray(pos, pos + len)));
      pos += len;
    } else if (wire === 0) [, pos] = varint(pos);
    else if (wire === 1) pos += 8;
    else if (wire === 5) pos += 4;
    else break;
  }
  return names;
}

function readEntryName(entry: Uint8Array): string {
  let pos = 0;
  const varint = (): number => {
    let result = 0;
    let shift = 0;
    for (;;) {
      const b = entry[pos++];
      result += (b & 0x7f) * 2 ** shift;
      if (!(b & 0x80)) return result;
      shift += 7;
    }
  };
  while (pos < entry.length) {
    const tag = varint();
    const wire = tag & 7;
    if (wire === 2) {
      const len = varint();
      if (Math.floor(tag / 8) === 1) return new TextDecoder().decode(entry.subarray(pos, pos + len));
      pos += len;
    } else if (wire === 0) varint();
    else if (wire === 1) pos += 8;
    else if (wire === 5) pos += 4;
    else break;
  }
  return '';
}

/** What a picture really is, judged by its first bytes rather than its file name. */
export function sniffImage(b: Uint8Array): Pick<ImportImage, 'ext' | 'mime'> | null {
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { ext: 'png', mime: 'image/png' };
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { ext: 'jpg', mime: 'image/jpeg' };
  if (b.length > 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return { ext: 'gif', mime: 'image/gif' };
  if (b.length > 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50)
    return { ext: 'webp', mime: 'image/webp' };
  return null;
}

// ---------------------------------------------------------------------------------------------
// Reading a package
// ---------------------------------------------------------------------------------------------

const bad = (message: string) => new HttpError(400, message);

/**
 * Newer Anki collections declare their name columns `COLLATE unicase`, a custom sort order that ordinary SQLite
 * does not have. Without it SQLite refuses to read some tables at all ("no such collation sequence"), even though
 * sort order is irrelevant for simply reading. Inside our private in-memory copy we swap it for the built-in
 * `nocase` (same length, so the file layout is untouched). Only the exact text "COLLATE unicase" followed by a
 * delimiter is changed, and the copy is only ever read, never saved.
 */
export function useBuiltInCollation(db: Uint8Array): Uint8Array {
  const buf = Buffer.from(db.buffer, db.byteOffset, db.byteLength);
  const needle = Buffer.from('unicase');
  for (let at = buf.indexOf(needle); at !== -1; at = buf.indexOf(needle, at + 1)) {
    const before = buf.toString('latin1', Math.max(0, at - 8), at).toLowerCase();
    const after = at + needle.length < buf.length ? buf[at + needle.length] : 0;
    const delimited = !((after >= 0x30 && after <= 0x39) || (after >= 0x41 && after <= 0x5a) || (after >= 0x61 && after <= 0x7a) || after === 0x5f);
    if (before === 'collate ' && delimited) buf.write('nocase ', at, 'latin1');
  }
  return buf;
}

export function readApkg(file: Uint8Array): ApkgPackage {
  let files: Record<string, Uint8Array>;
  let total = 0;
  try {
    files = unzipSync(file, {
      filter: (f) => {
        total += f.originalSize;
        if (total > MAX_ZIP_BYTES) throw bad('That Anki file is too large once unpacked.');
        return true;
      },
    });
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw bad("That doesn't look like an Anki deck file (.apkg). It couldn't be opened as a zip.");
  }

  const name = (['collection.anki21b', 'collection.anki21', 'collection.anki2'] as const).find((n) => files[n]);
  if (!name) throw bad("That zip isn't an Anki deck: it has no Anki collection inside.");
  const latest = name === 'collection.anki21b';
  let dbBytes = files[name];
  if (isZstd(dbBytes)) dbBytes = useBuiltInCollation(zstd(dbBytes, MAX_DB_BYTES));
  else if (latest) throw bad('This Anki file is damaged: its collection is not in the expected compressed format.');

  let db: Database.Database;
  try {
    db = new Database(Buffer.from(dbBytes.buffer, dbBytes.byteOffset, dbBytes.byteLength));
    // The file is untrusted: never run anything stored inside it, and never write to it.
    db.pragma('trusted_schema = OFF');
    db.pragma('query_only = ON');
  } catch {
    throw bad("This Anki file's collection couldn't be read (it may be damaged or from a very new Anki version).");
  }

  try {
    const { noteTypes, notes, decks } = readCollection(db);
    const roots = new Set(notes.map((n) => n.deck[0] ?? ''));
    const commonRoot = roots.size === 1 && notes.length > 0 && [...roots][0] !== '' ? [...roots][0] : null;
    return { format: latest ? 'newer Anki format' : 'older Anki format', noteTypes, notes, decks, commonRoot, media: readMedia(files, latest) };
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw bad(`This Anki file couldn't be understood (${(err as Error).message}).`);
  } finally {
    db.close();
  }
}

function readCollection(db: Database.Database) {
  const tables = new Set((db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((t) => t.name));
  // Real Anki collections hold plain tables. A crafted file could define these names as views running expensive queries.
  for (const needed of ['notes', 'cards']) if (!tables.has(needed)) throw new Error(`missing the ${needed} table`);

  // note type id -> { name, field names, is cloze }, and deck id -> name
  const types = new Map<string, { name: string; fields: string[]; cloze: boolean }>();
  const deckNames = new Map<string, string>();

  if (tables.has('notetypes')) {
    // Newer collections (see useBuiltInCollation for the sort-order workaround).
    for (const t of db.prepare('SELECT id, name FROM notetypes NOT INDEXED').all() as { id: number; name: string }[]) {
      types.set(String(t.id), { name: t.name, fields: [], cloze: false });
    }
    const fields = db.prepare('SELECT ntid, ord, name FROM fields ORDER BY ntid, ord').all() as { ntid: number; ord: number; name: string }[];
    for (const f of fields) types.get(String(f.ntid))?.fields.push(f.name);
    for (const d of db.prepare('SELECT id, name FROM decks NOT INDEXED').all() as { id: number; name: string }[]) deckNames.set(String(d.id), d.name);
  } else if (tables.has('col')) {
    const col = db.prepare('SELECT models, decks FROM col').get() as { models: string; decks: string };
    const models = JSON.parse(col.models) as Record<string, { name: string; flds: { name: string; ord: number }[]; type?: number }>;
    for (const [id, m] of Object.entries(models)) {
      types.set(id, { name: m.name, fields: [...m.flds].sort((a, b) => a.ord - b.ord).map((f) => f.name), cloze: m.type === 1 });
    }
    for (const [id, d] of Object.entries(JSON.parse(col.decks) as Record<string, { name: string }>)) deckNames.set(id, d.name);
  } else throw new Error('no notes table');

  // The deck of a note = the deck of its first card (its original deck if it sits in a filtered deck).
  const noteDeck = new Map<number, string>();
  const cards = db.prepare('SELECT id, nid, did, odid FROM cards NOT INDEXED ORDER BY id').all() as { id: number; nid: number; did: number; odid: number }[];
  for (const c of cards) if (!noteDeck.has(c.nid)) noteDeck.set(c.nid, String(c.odid || c.did));

  const notes: ApkgNote[] = [];
  const typeCount = new Map<string, number>();
  const deckCount = new Map<string, number>();
  for (const n of db.prepare('SELECT id, mid, flds FROM notes NOT INDEXED ORDER BY id').all() as { id: number; mid: number; flds: string }[]) {
    const typeId = String(n.mid);
    const type = types.get(typeId);
    if (!type) continue;
    const fields = n.flds.split('\x1f');
    if (hasCloze(fields[0] ?? '')) type.cloze = true;
    let deck = splitFolderPath(deckNames.get(noteDeck.get(n.id) ?? '') ?? '');
    if (deck.length === 1 && deck[0].toLowerCase() === 'default') deck = []; // Anki's built-in catch-all deck, not a real folder
    notes.push({ typeId, fields, deck });
    typeCount.set(typeId, (typeCount.get(typeId) ?? 0) + 1);
    const key = deck.join(' / ');
    deckCount.set(key, (deckCount.get(key) ?? 0) + 1);
  }

  const noteTypes: ApkgNoteType[] = [];
  for (const [id, t] of types) {
    const count = typeCount.get(id) ?? 0;
    if (count === 0) continue;
    const first = notes.find((n) => n.typeId === id);
    noteTypes.push({
      id,
      name: t.name,
      fields: t.fields.length ? t.fields : (first?.fields ?? []).map((_, i) => `Field ${i + 1}`),
      cloze: t.cloze,
      count,
      examples: (first?.fields ?? []).map((f) => cleanField(f, true).text.slice(0, 60)),
    });
  }
  noteTypes.sort((a, b) => b.count - a.count);
  const decks = [...deckCount.entries()].map(([path, count]) => ({ path, count })).sort((a, b) => a.path.localeCompare(b.path));
  return { noteTypes, notes, decks };
}

function readMedia(files: Record<string, Uint8Array>, latest: boolean): Map<string, Uint8Array> {
  const media = new Map<string, Uint8Array>();
  let list = files['media'];
  if (!list) return media;
  if (isZstd(list)) list = zstd(list, 50 * 1024 * 1024);

  let names: string[];
  if (!latest && list[0] === 0x7b /* "{" */) {
    const map = JSON.parse(new TextDecoder().decode(list)) as Record<string, string>;
    names = [];
    for (const [member, fileName] of Object.entries(map)) names[Number(member)] = fileName;
  } else {
    try {
      names = parseMediaEntries(list);
    } catch {
      return media; // an unreadable media list just means no pictures
    }
  }
  names.forEach((fileName, index) => {
    let data = files[String(index)];
    if (!fileName || !data) return;
    if (isZstd(data)) {
      try {
        data = zstd(data, MAX_IMAGE_BYTES * 2);
      } catch {
        return;
      }
    }
    media.set(fileName, data);
  });
  return media;
}

// ---------------------------------------------------------------------------------------------
// Turning notes into Georgie cards
// ---------------------------------------------------------------------------------------------

const FRONT_FIELD = ['front', 'question', 'term', 'word', 'prompt', 'q', 'kanji', 'expression', 'text'];
// In order of preference: if a note type has both "Meaning" and "Reading", the meaning is the better back.
const BACK_FIELD = ['back', 'answer', 'definition', 'meaning', 'translation', 'response', 'a', 'reading'];

export function defaultMappings(pkg: ApkgPackage): ApkgMappings {
  const out: ApkgMappings = {};
  for (const t of pkg.noteTypes) {
    const names = t.fields.map((f) => f.trim().toLowerCase());
    const named = (list: string[]) => {
      for (const wanted of list) {
        const at = names.indexOf(wanted);
        if (at >= 0) return at;
      }
      return -1;
    };
    let front = named(FRONT_FIELD);
    let back = t.cloze ? (named(['back extra', 'extra']) >= 0 ? named(['back extra', 'extra']) : t.fields.length > 1 ? 1 : -1) : named(BACK_FIELD);
    if (front < 0) front = 0;
    if (back < 0 || back === front) back = t.fields.length > 1 ? (front === 0 ? 1 : 0) : -1;
    out[t.id] = { front, back: back >= 0 ? back : null };
  }
  return out;
}

export interface ApkgBuild {
  items: ImportItem[];
  stats: {
    notes: number;
    /** Pictures included. */
    images: number;
    /** Picture references whose file wasn't in the package. */
    missingMedia: number;
    /** Pictures in a format Georgie can't show (e.g. SVG) or that are over 10 MB. */
    unsupportedMedia: number;
    cloze: number;
    /** Sounds/videos mentioned in cards (never imported). */
    audio: number;
  };
}

const lookup = (pkg: ApkgPackage, ref: string): Uint8Array | undefined => {
  if (pkg.media.has(ref)) return pkg.media.get(ref);
  try {
    return pkg.media.get(decodeURIComponent(ref));
  } catch {
    return undefined;
  }
};

/** `stripCommonRoot`: drop the shared top-level deck, because its name becomes the destination folder. */
export function buildApkgItems(pkg: ApkgPackage, mappings: ApkgMappings, opts: { stripCommonRoot?: boolean } = {}): ApkgBuild {
  const defaults = defaultMappings(pkg);
  const types = new Map(pkg.noteTypes.map((t) => [t.id, t]));
  const stats = { notes: 0, images: 0, missingMedia: 0, unsupportedMedia: 0, cloze: 0, audio: 0 };
  const items: ImportItem[] = [];

  for (const note of pkg.notes) {
    const type = types.get(note.typeId);
    if (!type) continue;
    const m = mappings[note.typeId] ?? defaults[note.typeId];
    const rawFront = note.fields[m.front] ?? '';
    const rawBack = m.back === null ? '' : (note.fields[m.back] ?? '');
    stats.audio += (rawFront.match(/\[sound:/gi)?.length ?? 0) + (rawBack.match(/\[sound:/gi)?.length ?? 0);

    const f = cleanField(rawFront, true);
    const b = cleanField(rawBack, true);
    let front = f.text;
    let back = b.text;
    if (hasCloze(front)) {
      const c = splitCloze(front);
      front = c.front;
      back = back ? `${c.back}\n\n${back}` : c.back;
      stats.cloze++;
    }

    const images: ImportImage[] = [];
    for (const [side, refs] of [['front', f.images], ['back', b.images]] as const) {
      for (const ref of refs) {
        const data = lookup(pkg, ref);
        if (!data) {
          stats.missingMedia++;
          continue;
        }
        const kind = sniffImage(data);
        if (!kind || data.length > MAX_IMAGE_BYTES) {
          stats.unsupportedMedia++;
          continue;
        }
        images.push({ side, ...kind, data: Buffer.from(data) });
      }
    }
    stats.images += images.length;
    stats.notes++;
    const path = opts.stripCommonRoot && pkg.commonRoot ? note.deck.slice(1) : note.deck;
    items.push({ path, front: front.slice(0, MAX_FIELD_LENGTH), back: back.slice(0, MAX_FIELD_LENGTH), images });
  }
  return { items, stats };
}
