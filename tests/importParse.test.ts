import { describe, expect, it } from 'vitest';
import {
  buildCards,
  cleanField,
  decodeBytes,
  detectDelimiter,
  folderSummary,
  parseDelimited,
  parseImportText,
  sampleIndexes,
  splitCloze,
  splitFolderPath,
  type ParsedTable,
} from '../shared/importParse';

const parse = (text: string, forced = {}) => parseImportText(text, forced) as ParsedTable;
const cardsOf = (t: ParsedTable) => buildCards(t, t.mapping).cards;

describe('splitting rows and columns', () => {
  it('handles quotes, doubled quotes, commas and newlines inside quoted fields', () => {
    const rows = parseDelimited('a,"b, c","say ""hi"""\r\n"line1\nline2",x,y\r\n', ',');
    expect(rows).toEqual([['a', 'b, c', 'say "hi"'], ['line1\nline2', 'x', 'y']]);
  });
  it('drops blank lines but keeps a last row with no trailing newline', () => {
    expect(parseDelimited('a,b\n\n\nc,d', ',')).toEqual([['a', 'b'], ['c', 'd']]);
  });
  it('keeps empty cells', () => {
    expect(parseDelimited('a,,c\n,b,', ',')).toEqual([['a', '', 'c'], ['', 'b', '']]);
  });
  it('picks the separator whose columns line up', () => {
    expect(detectDelimiter('cat\tA small, furry animal\ndog\tA loyal, friendly pet\nfish\tLives in water, swims')).toBe('\t');
    expect(detectDelimiter('Front,Back\nhola,hello\nadios,goodbye')).toBe(',');
    expect(detectDelimiter('Front;Back\nhola;hello, friend\nadios;goodbye')).toBe(';');
    expect(detectDelimiter('a|b\nc|d')).toBe('|');
  });
});

describe('recognising where a file came from', () => {
  it("Georgie's own export (with the BOM Excel likes) imports back to the same folders, fronts and backs", () => {
    const t = parse('﻿Folder,Front,Back\r\nSpanish,hola,hello\r\n"Spanish / Verbs, basics","say ""eat""","comer\nto eat"\r\n');
    expect(t.source).toBe('Georgie');
    expect(t.hasHeader).toBe(true);
    expect(t.mapping).toEqual({ front: 1, back: 2, folder: 0 });
    expect(cardsOf(t)).toEqual([
      { path: ['Spanish'], front: 'hola', back: 'hello' },
      { path: ['Spanish', 'Verbs, basics'], front: 'say "eat"', back: 'comer\nto eat' },
    ]);
  });

  it('Anki "Notes in Plain Text" export: reads the #header lines, skips tags, finds the deck column', () => {
    const text = [
      '#separator:tab',
      '#html:true',
      '#guid column:1',
      '#notetype column:2',
      '#deck column:3',
      '#tags column:6',
      'g1\tBasic\tBiology::Cells\tWhat is the powerhouse of the cell?\tThe <b>mitochondrion</b><br>(makes ATP)\tbio cells',
      'g2\tBasic\tBiology\tWhat makes proteins?\tRibosomes&nbsp;\t',
    ].join('\n');
    const t = parse(text);
    expect(t.source).toBe('Anki');
    expect(t.html).toBe(true);
    expect(t.mapping).toEqual({ front: 3, back: 4, folder: 2 });
    expect(t.metaColumns.sort()).toEqual([0, 1, 5]);
    expect(cardsOf(t)).toEqual([
      { path: ['Biology', 'Cells'], front: 'What is the powerhouse of the cell?', back: 'The mitochondrion\n(makes ATP)' },
      { path: ['Biology'], front: 'What makes proteins?', back: 'Ribosomes' },
    ]);
  });

  it('Anki export with a #columns line uses those names', () => {
    const t = parse('#separator:tab\n#html:false\n#columns:Front\tBack\tTags\ncat\tgato\tpets\ndog\tperro\tpets');
    expect(t.headers).toEqual(['Front', 'Back', 'Tags']);
    expect(t.hasHeader).toBe(false); // the #columns line isn't a data row
    expect(cardsOf(t).map((c) => [c.front, c.back])).toEqual([['cat', 'gato'], ['dog', 'perro']]);
  });

  it('Quizlet export: tab between term and definition, commas inside definitions are not separators', () => {
    const t = parse('mitosis\tCell division, producing two identical cells\nmeiosis\tCell division producing four gametes\nosmosis\tWater moving across a membrane, high to low');
    expect(t.source).toBe('Quizlet');
    expect(t.delimiter).toBe('\t');
    expect(t.hasHeader).toBe(false);
    expect(cardsOf(t)[0]).toEqual({ path: [], front: 'mitosis', back: 'Cell division, producing two identical cells' });
  });

  it('a spreadsheet with Question/Answer headers', () => {
    const t = parse('Question,Answer,Notes\n2+2?,4,easy\n3+3?,6,easy');
    expect(t.hasHeader).toBe(true);
    expect(t.mapping).toMatchObject({ front: 0, back: 1 });
    expect(cardsOf(t)).toHaveLength(2);
  });

  it('works out front/back from header names even when the columns are in a different order, and ignores tags', () => {
    const t = parse('Tags,Answer,Question\nx,Paris,Capital of France?\nx,Rome,Capital of Italy?');
    expect(t.mapping).toMatchObject({ front: 2, back: 1 });
    expect(cardsOf(t)[0]).toMatchObject({ front: 'Capital of France?', back: 'Paris' });
  });

  it('European semicolon files', () => {
    const t = parse('Term;Definition\nhola;hello, friend\nadios;goodbye');
    expect(t.delimiter).toBe(';');
    expect(cardsOf(t)[0]).toMatchObject({ front: 'hola', back: 'hello, friend' });
  });

  it('a two-column file with unknown headers is treated as data, and the user can turn the header on', () => {
    const text = 'Spanish,English\nhola,hello\nadios,goodbye';
    const guess = parse(text);
    expect(guess.hasHeader).toBe(false);
    expect(cardsOf(guess)).toHaveLength(3);
    const forced = parse(text, { hasHeader: true });
    expect(forced.hasHeader).toBe(true);
    expect(forced.headers).toEqual(['Spanish', 'English']);
    expect(cardsOf(forced)).toHaveLength(2);
  });

  it('the user can force a separator', () => {
    const t = parse('a b\nc d', { delimiter: ' ' });
    expect(t.delimiter).toBe(' ');
    expect(cardsOf(t)[0]).toMatchObject({ front: 'a', back: 'b' });
  });

  it('swapping front and back is just a different mapping', () => {
    const t = parse('hola\thello\nadios\tgoodbye');
    const swapped = buildCards(t, { ...t.mapping, front: t.mapping.back, back: t.mapping.front }).cards;
    expect(swapped[0]).toMatchObject({ front: 'hello', back: 'hola' });
  });

  it('returns null for an empty file', () => {
    expect(parseImportText('')).toBeNull();
    expect(parseImportText('\n\n  \n')).toBeNull();
  });

  it('ragged rows are padded, not crashed on', () => {
    const t = parse('Front,Back\nonly front\nfull,row');
    expect(cardsOf(t)).toEqual([
      { path: [], front: 'only front', back: '' },
      { path: [], front: 'full', back: 'row' },
    ]);
  });

  it('counts and skips rows with nothing in them', () => {
    const t = parse('Front,Back\nhi,there\n ,\nbye,now');
    const r = buildCards(t, t.mapping);
    expect(r.cards).toHaveLength(2);
    expect(r.empty).toBe(1);
  });
});

describe('cleaning field text', () => {
  it('converts HTML to plain text', () => {
    expect(cleanField('Line 1<br>Line 2<div>Line 3</div><b>bold</b> &amp; &lt;ok&gt;&nbsp;', true).text).toBe('Line 1\nLine 2\nLine 3\nbold & <ok>');
    expect(cleanField('<ul><li>one</li><li>two</li></ul>', true).text).toBe('• one\n• two');
  });
  it('reports pictures it cannot import from a text file, and drops sound tags', () => {
    const c = cleanField('Name this <img src="heart.png"> and <img src=\'lung.jpg\'> [sound:x.mp3]', true);
    expect(c.images).toEqual(['heart.png', 'lung.jpg']);
    expect(c.text).toBe('Name this  and');
  });
  it('leaves ordinary text with < and > alone', () => {
    expect(cleanField('is x < y and y > z?', false).text).toBe('is x < y and y > z?');
    expect(cleanField('a <not a tag> b', false).text).toBe('a <not a tag> b');
  });
  it('decodes numeric entities', () => {
    expect(cleanField('caf&#233; &#x1F600;', true).text).toBe('café 😀');
  });
  it('turns cloze deletions into a question and an answer', () => {
    expect(splitCloze('The {{c1::mitochondrion}} makes {{c2::ATP::molecule}}.')).toEqual({
      front: 'The […] makes [molecule].',
      back: 'The mitochondrion makes ATP.',
    });
    const t = parse('#separator:tab\n#html:true\nThe {{c1::sun}} is a star.\tAstronomy fact');
    const r = buildCards(t, { front: 0, back: 1, folder: null });
    expect(r.cloze).toBe(1);
    expect(r.cards[0]).toEqual({ path: [], front: 'The […] is a star.', back: 'The sun is a star.\n\nAstronomy fact' });
  });
  it('flags cards that mention pictures', () => {
    const t = parse('#separator:tab\n#html:true\nWho?<img src="a.png">\tMe\nPlain\tCard');
    expect(buildCards(t, t.mapping).missingImages).toBe(1);
  });
});

describe('folders from a file', () => {
  it('understands Georgie, Anki and raw separators, and limits depth and length', () => {
    expect(splitFolderPath('Biology / Cells')).toEqual(['Biology', 'Cells']);
    expect(splitFolderPath('Biology::Cells::Organelles')).toEqual(['Biology', 'Cells', 'Organelles']);
    expect(splitFolderPath('Biology\x1fCells')).toEqual(['Biology', 'Cells']);
    expect(splitFolderPath('AC/DC')).toEqual(['AC/DC']); // a slash inside a name is just part of the name
    expect(splitFolderPath('a::b::c::d::e::f::g::h')).toHaveLength(6);
    expect(splitFolderPath('x'.repeat(300))[0]).toHaveLength(100);
    expect(splitFolderPath(' :: ')).toEqual([]);
  });
  it('summarises where the cards would go', () => {
    expect(folderSummary([{ path: ['A'], front: '', back: '' }, { path: ['A'], front: '', back: '' }, { path: [], front: '', back: '' }])).toEqual([
      { path: '', count: 1 },
      { path: 'A', count: 2 },
    ]);
  });
});

describe('reading bytes', () => {
  it('handles UTF-8, a UTF-8 BOM, UTF-16, and old Windows files', () => {
    const enc = new TextEncoder();
    expect(decodeBytes(enc.encode('café')).text).toBe('café');
    expect(decodeBytes(new Uint8Array([0xef, 0xbb, 0xbf, ...enc.encode('café')])).text).toBe('café');
    const utf16 = new Uint8Array([0xff, 0xfe, ...[...'café'].flatMap((c) => [c.charCodeAt(0) & 255, c.charCodeAt(0) >> 8])]);
    expect(decodeBytes(utf16).text).toBe('café');
    const win = decodeBytes(new Uint8Array([0x63, 0x61, 0x66, 0xe9])); // "café" in Windows-1252
    expect(win.text).toBe('café');
    expect(win.note).toMatch(/Windows-1252/);
  });
});

describe('the preview sample', () => {
  it('shows first, middle and last, or everything for small files', () => {
    expect(sampleIndexes(2)).toEqual([0, 1]);
    expect(sampleIndexes(0)).toEqual([]);
    expect(sampleIndexes(101)).toEqual([0, 50, 100]);
  });
  it('can show a different, repeatable spread of 3 distinct cards', () => {
    const a = sampleIndexes(500, 1);
    expect(a).toHaveLength(3);
    expect(new Set(a).size).toBe(3);
    expect(sampleIndexes(500, 1)).toEqual(a);
    expect(sampleIndexes(500, 2)).not.toEqual(a);
    expect(Math.max(...a)).toBeLessThan(500);
  });
});
