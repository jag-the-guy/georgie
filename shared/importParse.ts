/**
 * Reads flashcard files exported from other apps (CSV / TSV / text) and works out which column is
 * the front and which is the back. Pure functions, so the browser can re-run them instantly when the
 * user changes a setting on the preview screen.
 */

export type SourceApp = 'Georgie' | 'Anki' | 'Quizlet' | 'Spreadsheet';

export interface ImportCard {
  /** Folder path inside the destination, e.g. ["Biology", "Cells"]. Empty = the destination folder itself. */
  path: string[];
  front: string;
  back: string;
}

export interface ParsedTable {
  delimiter: string;
  /** Every row of the file as text, including the header row if there is one. */
  rows: string[][];
  hasHeader: boolean;
  /** Column names: from the file's header, or "Column 1", "Column 2"... */
  headers: string[];
  mapping: Mapping;
  source: SourceApp;
  /** Plain-English description of what we think this file is. */
  description: string;
  /** True when field text contains HTML that should be converted (Anki exports). */
  html: boolean;
  /** Columns that are bookkeeping (tags, note type, ...), never offered as the default front/back. */
  metaColumns: number[];
}

export interface Mapping {
  front: number;
  back: number;
  /** Column holding a folder/deck path, or null for none. */
  folder: number | null;
}

export const MAX_FOLDER_DEPTH = 6;
export const MAX_NAME_LENGTH = 100;
export const MAX_FIELD_LENGTH = 20_000;

const DELIMITERS = ['\t', ',', ';', '|'];
const FRONT_NAMES = ['front', 'question', 'term', 'word', 'prompt', 'q', 'side 1', 'side1', 'side a', 'kanji', 'vocab'];
const BACK_NAMES = ['back', 'answer', 'definition', 'meaning', 'response', 'a', 'side 2', 'side2', 'side b', 'translation', 'reading'];
const FOLDER_NAMES = ['folder', 'deck', 'category', 'set', 'subject', 'chapter', 'topic'];
const META_NAMES = ['tags', 'tag', 'notetype', 'note type', 'guid', 'id', 'note id', 'noteid', 'type', 'created', 'modified'];

// ---------------------------------------------------------------------------------------------
// Decoding bytes to text
// ---------------------------------------------------------------------------------------------

/** Turns file bytes into text, handling UTF-8 (with or without BOM), UTF-16 and old Windows files. */
export function decodeBytes(bytes: Uint8Array): { text: string; note: string | null } {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return { text: new TextDecoder('utf-16le').decode(bytes.subarray(2)), note: null };
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return { text: new TextDecoder('utf-16be').decode(bytes.subarray(2)), note: null };
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, ''), note: null };
  } catch {
    return {
      text: new TextDecoder('windows-1252').decode(bytes),
      note: "This file isn't UTF-8, so it was read as Windows-1252. If accented letters look wrong, re-save it as UTF-8.",
    };
  }
}

// ---------------------------------------------------------------------------------------------
// Splitting into rows and columns
// ---------------------------------------------------------------------------------------------

/** RFC 4180 style parser: quoted fields, doubled quotes, newlines inside quotes. Blank lines are dropped. */
export function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let atFieldStart = true;

  const endField = () => {
    row.push(field);
    field = '';
    atFieldStart = true;
  };
  const endRow = () => {
    endField();
    if (!(row.length === 1 && row[0].trim() === '')) rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"' && atFieldStart) {
      quoted = true;
      atFieldStart = false;
    } else if (c === delimiter) endField();
    else if (c === '\n') endRow();
    else if (c === '\r') {
      if (text[i + 1] === '\n') i++;
      endRow();
    } else {
      field += c;
      atFieldStart = false;
    }
  }
  if (field !== '' || row.length > 0) endRow();
  return rows;
}

/** Picks the separator whose columns are most consistent from row to row. */
export function detectDelimiter(text: string): string {
  const sample = text.split(/\r?\n/).slice(0, 60).join('\n');
  let best = ',';
  let bestScore = -1;
  for (const d of DELIMITERS) {
    const rows = parseDelimited(sample, d).slice(0, 40);
    if (rows.length === 0) continue;
    const counts = new Map<number, number>();
    for (const r of rows) counts.set(r.length, (counts.get(r.length) ?? 0) + 1);
    const [cols, agreeing] = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0];
    if (cols < 2) continue;
    const score = (agreeing / rows.length) * 100 + Math.min(cols, 4); // consistency first, a little credit for more columns
    if (score > bestScore + 0.001) {
      bestScore = score;
      best = d;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------------------------
// Anki's text export starts with "#key:value" lines
// ---------------------------------------------------------------------------------------------

interface AnkiHeader {
  separator?: string;
  html?: boolean;
  columns?: string[];
  deckColumn?: number;
  tagsColumn?: number;
  notetypeColumn?: number;
  guidColumn?: number;
}

const SEPARATOR_NAMES: Record<string, string> = { tab: '\t', comma: ',', semicolon: ';', pipe: '|', space: ' ', colon: ':' };

function takeAnkiHeader(text: string): { header: AnkiHeader | null; body: string } {
  const lines = text.split(/\r?\n/);
  const header: AnkiHeader = {};
  let n = 0;
  for (; n < lines.length && lines[n].startsWith('#'); n++) {
    const m = /^#([^:]+):(.*)$/.exec(lines[n]);
    if (!m) continue;
    const key = m[1].trim().toLowerCase();
    const value = m[2];
    if (key === 'separator') header.separator = SEPARATOR_NAMES[value.trim().toLowerCase()] ?? (value.length === 1 ? value : undefined);
    else if (key === 'html') header.html = value.trim().toLowerCase() === 'true';
    else if (key === 'columns') header.columns = [value];
    else if (key === 'deck column') header.deckColumn = Number(value);
    else if (key === 'tags column') header.tagsColumn = Number(value);
    else if (key === 'notetype column') header.notetypeColumn = Number(value);
    else if (key === 'guid column') header.guidColumn = Number(value);
  }
  if (n === 0) return { header: null, body: text };
  return { header, body: lines.slice(n).join('\n') };
}

// ---------------------------------------------------------------------------------------------
// The main entry point
// ---------------------------------------------------------------------------------------------

const norm = (s: string) => s.trim().toLowerCase();

function looksLikeHeader(row: string[]): boolean {
  const known = [...FRONT_NAMES, ...BACK_NAMES, ...FOLDER_NAMES, ...META_NAMES];
  const matches = row.filter((c) => known.includes(norm(c))).length;
  return matches >= 2 || (matches >= 1 && row.length === matches);
}

function guessMapping(headers: string[], hasNames: boolean, meta: number[], folderHint: number | null): Mapping {
  const idx = (names: string[]) => (hasNames ? headers.findIndex((h, i) => !meta.includes(i) && names.includes(norm(h))) : -1);
  let folder = folderHint ?? (hasNames ? headers.findIndex((h) => FOLDER_NAMES.includes(norm(h))) : -1);
  if (folder < 0) folder = -1;
  let front = idx(FRONT_NAMES);
  let back = idx(BACK_NAMES);
  const usable = headers.map((_, i) => i).filter((i) => i !== folder && !meta.includes(i));
  if (front < 0 || back < 0 || front === back) {
    front = usable[0] ?? 0;
    back = usable[1] ?? (usable[0] === 0 ? 1 : 0);
  }
  return { front, back, folder: folder >= 0 ? folder : null };
}

/** Looks at the file and works out its layout. `forced` lets the user override the guesses. */
export function parseImportText(
  text: string,
  forced: { delimiter?: string; hasHeader?: boolean } = {},
): ParsedTable | null {
  const { header: anki, body } = takeAnkiHeader(text.replace(/^﻿/, ''));
  const delimiter = forced.delimiter ?? anki?.separator ?? detectDelimiter(body);
  const allRows = parseDelimited(body, delimiter);
  if (allRows.length === 0) return null;

  const width = Math.max(...allRows.slice(0, 200).map((r) => r.length));
  const pad = (r: string[]) => (r.length < width ? [...r, ...Array(width - r.length).fill('')] : r);
  const rows = allRows.map(pad);

  const meta: number[] = [];
  let headers: string[];
  let hasHeader: boolean;
  let folderHint: number | null = null;
  let source: SourceApp;
  let description: string;

  const sepName = delimiter === '\t' ? 'tab' : delimiter === ',' ? 'comma' : delimiter === ';' ? 'semicolon' : delimiter === '|' ? 'pipe' : `"${delimiter}"`;

  if (anki) {
    source = 'Anki';
    hasHeader = false;
    headers = anki.columns?.[0] ? anki.columns[0].split(delimiter) : Array.from({ length: width }, (_, i) => `Column ${i + 1}`);
    headers = Array.from({ length: width }, (_, i) => headers[i] ?? `Column ${i + 1}`);
    for (const c of [anki.tagsColumn, anki.notetypeColumn, anki.guidColumn]) if (c && c >= 1 && c <= width) meta.push(c - 1);
    if (anki.deckColumn && anki.deckColumn >= 1 && anki.deckColumn <= width) folderHint = anki.deckColumn - 1;
    description = `Anki text export (${sepName}-separated, ${width} columns)`;
  } else {
    hasHeader = forced.hasHeader ?? looksLikeHeader(rows[0]);
    headers = hasHeader ? rows[0].map((h, i) => h.trim() || `Column ${i + 1}`) : Array.from({ length: width }, (_, i) => `Column ${i + 1}`);
    if (hasHeader) headers.forEach((h, i) => META_NAMES.includes(norm(h)) && meta.push(i));
    const georgie = hasHeader && headers.length === 3 && headers.map(norm).join('|') === 'folder|front|back';
    if (georgie) {
      source = 'Georgie';
      description = "Georgie export (Folder, Front, Back)";
    } else if (!hasHeader && delimiter === '\t' && width === 2) {
      source = 'Quizlet';
      description = 'Looks like a Quizlet-style export (term and definition separated by a tab)';
    } else {
      source = 'Spreadsheet';
      description = `${sepName[0].toUpperCase() + sepName.slice(1)}-separated file, ${width} columns${hasHeader ? ', with a header row' : ', no header row'}`;
    }
  }
  if (forced.hasHeader !== undefined && anki === null) hasHeader = forced.hasHeader;

  const mapping = guessMapping(headers, hasHeader || Boolean(anki?.columns), meta, folderHint);
  return { delimiter, rows, hasHeader, headers, mapping, source, description, html: anki?.html ?? false, metaColumns: meta };
}

// ---------------------------------------------------------------------------------------------
// Cleaning field text
// ---------------------------------------------------------------------------------------------

const KNOWN_TAGS = 'br|div|p|b|i|u|em|strong|span|img|ul|ol|li|font|a|sub|sup|table|tr|td|th|tbody|thead|h[1-6]|hr|code|pre|blockquote';
const TAG_TEST = new RegExp(`<\\/?(${KNOWN_TAGS})(\\s[^>]*)?\\/?>`, 'i');

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', laquo: '«', raquo: '»', copy: '©', times: '×', divide: '÷', deg: '°' };

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === '#') {
      const code = body[1].toLowerCase() === 'x' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[body.toLowerCase()] ?? whole;
  });
}

export interface CleanedField {
  text: string;
  /** File names mentioned by <img src="..."> (pictures we can't get from a text file). */
  images: string[];
}

/** Turns a field that may contain HTML into the plain text Georgie stores. */
export function cleanField(raw: string, html: boolean): CleanedField {
  let s = raw.replace(/\r\n?/g, '\n');
  const images: string[] = [];
  if (html || TAG_TEST.test(s)) {
    s = s.replace(/<img\b[^>]*?\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>/gi, (_m, a, b, c) => {
      images.push(decodeEntities(a ?? b ?? c ?? ''));
      return '';
    });
    s = s
      .replace(/<br\s*\/?>/gi, '\n')
      // Block tags (opening or closing) mean "new line", but a run of them, or one next to a real newline, is only one.
      .replace(/<\/?(div|p|tr|h[1-6]|blockquote|pre)(\s[^>]*)?>/gi, '\u0001')
      .replace(/\n*\u0001+\n*/g, '\n')
      .replace(/<li\b[^>]*>/gi, '\n• ')
      .replace(new RegExp(`<\\/?(${KNOWN_TAGS})(\\s[^>]*)?\\/?>`, 'gi'), '');
    s = decodeEntities(s);
  }
  s = s
    .replace(/\[sound:[^\]]*\]/gi, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { text: s.length > MAX_FIELD_LENGTH ? s.slice(0, MAX_FIELD_LENGTH) : s, images };
}

const CLOZE = /\{\{c\d+::([\s\S]*?)(?:::([\s\S]*?))?\}\}/g;
export const hasCloze = (s: string) => /\{\{c\d+::/.test(s);

/** Anki "fill in the blank" text: the front shows [...] (or the hint), the back shows the full sentence. */
export function splitCloze(text: string): { front: string; back: string } {
  return {
    front: text.replace(CLOZE, (_m, _answer: string, hint?: string) => (hint ? `[${hint}]` : '[…]')),
    back: text.replace(CLOZE, (_m, answer: string) => answer),
  };
}

// ---------------------------------------------------------------------------------------------
// Turning rows into cards
// ---------------------------------------------------------------------------------------------

export function splitFolderPath(raw: string): string[] {
  return raw
    .split(/::|\x1f| \/ /)
    .map((p) => p.trim().slice(0, MAX_NAME_LENGTH))
    .filter(Boolean)
    .slice(0, MAX_FOLDER_DEPTH);
}

export interface BuildResult {
  cards: ImportCard[];
  /** Rows with nothing in the front and back. */
  empty: number;
  /** Cards whose text referred to pictures that a text file cannot contain. */
  missingImages: number;
  cloze: number;
  /** Rows that had text cut off for being very long. */
  truncated: number;
}

export function buildCards(table: ParsedTable, mapping: Mapping): BuildResult {
  const rows = table.hasHeader ? table.rows.slice(1) : table.rows;
  const out: BuildResult = { cards: [], empty: 0, missingImages: 0, cloze: 0, truncated: 0 };

  for (const row of rows) {
    const f = cleanField(row[mapping.front] ?? '', table.html);
    const b = cleanField(row[mapping.back] ?? '', table.html);
    let front = f.text;
    let back = b.text;
    if (hasCloze(front)) {
      const c = splitCloze(front);
      front = c.front;
      back = back ? `${c.back}\n\n${back}` : c.back;
      out.cloze++;
    }
    if (!front && !back) {
      out.empty++;
      continue;
    }
    if (f.images.length + b.images.length > 0) out.missingImages++;
    if ((row[mapping.front]?.length ?? 0) > MAX_FIELD_LENGTH || (row[mapping.back]?.length ?? 0) > MAX_FIELD_LENGTH) out.truncated++;
    const path = mapping.folder !== null ? splitFolderPath(row[mapping.folder] ?? '') : [];
    out.cards.push({ path, front, back });
  }
  return out;
}

/** Which 3 cards to show on the preview screen: first, middle and last, or a different spread on request. */
export function sampleIndexes(count: number, shift = 0): number[] {
  if (count <= 3) return Array.from({ length: count }, (_, i) => i);
  if (shift === 0) return [0, Math.floor((count - 1) / 2), count - 1];
  // Deterministic pseudo-random pick (mulberry32), so "show different cards" is repeatable.
  let a = (shift * 0x9e3779b9) >>> 0;
  const rand = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const picked = new Set<number>();
  while (picked.size < 3) picked.add(Math.floor(rand() * count));
  return [...picked].sort((x, y) => x - y);
}

/** Folder names a set of cards would create, with counts, for the preview ("Biology / Cells: 12 cards"). */
export function folderSummary(cards: ImportCard[]): { path: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const c of cards) {
    const key = c.path.join(' / ');
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].map(([path, count]) => ({ path, count })).sort((a, b) => a.path.localeCompare(b.path));
}
