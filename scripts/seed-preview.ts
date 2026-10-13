/**
 * Fills the local preview copy of Georgie with demo data, and writes sample files to try the Import feature with.
 *
 *   npx tsx scripts/seed-preview.ts http://localhost:3011
 *
 * Safe to run again: if the demo account already exists it does nothing. The demo login is written to
 * preview/demo-account.json (git-ignored), never printed.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { buildApkg } from '../tests/apkgFixture';

const API = `${process.argv[2] ?? 'http://localhost:3011'}/api`;
const root = path.join(import.meta.dirname, '..', 'preview');
const files = path.join(root, 'sample-files');
fs.mkdirSync(files, { recursive: true });

// ---------------------------------------------------------------- tiny PNG maker (for demo pictures)
function png(w: number, h: number, pixel: (x: number, y: number) => [number, number, number]): Uint8Array {
  const rows: number[] = [];
  for (let y = 0; y < h; y++) {
    rows.push(0);
    for (let x = 0; x < w; x++) rows.push(...pixel(x, y));
  }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.from(rows))), chunk('IEND', Buffer.alloc(0))]);
}
const ellipse = (w: number, h: number, inside: [number, number, number], outside: [number, number, number]) =>
  png(w, h, (x, y) => (((x - w / 2) / (w / 2.3)) ** 2 + ((y - h / 2) / (h / 2.3)) ** 2 < 1 ? inside : outside));
const stripes = (w: number, h: number, a: [number, number, number], b: [number, number, number]) => png(w, h, (x, y) => (Math.floor((x + y) / 14) % 2 ? a : b));

const HEART = ellipse(220, 140, [226, 84, 107], [253, 235, 238]);
const BONE = stripes(220, 120, [110, 160, 230], [227, 240, 251]);
const CELL = ellipse(220, 140, [139, 111, 214], [238, 233, 251]);

// ---------------------------------------------------------------- sample files for the Import button
fs.writeFileSync(
  path.join(files, '1-quizlet-style.txt'),
  'mitosis\tCell division, producing two identical cells\nmeiosis\tCell division producing four gametes\nosmosis\tWater moving across a membrane, high to low\nphotosynthesis\tPlants turn light, water and CO2 into sugar\nrespiration\tCells release energy from glucose\n',
);
fs.writeFileSync(
  path.join(files, '2-anki-plain-text.txt'),
  '#separator:tab\n#html:true\n#guid column:1\n#notetype column:2\n#deck column:3\n#tags column:6\ng1\tBasic\tFrench::Verbs\tmanger\tto eat<br>(regular -er verb)\tverbs\ng2\tBasic\tFrench::Verbs\tparler\tto speak\tverbs\ng3\tBasic\tFrench::Food\tla pomme\tthe apple\tfood\ng4\tCloze\tFrench::Food\tLe {{c1::pain}} est blanc.\t\tfood\n',
);
fs.writeFileSync(path.join(files, '3-spreadsheet-with-header.csv'), 'Question,Answer,Notes\n"What is 7 x 8?",56,times table\n"Square root of 144?",12,\n"Value of pi (2 d.p.)?",3.14,"approximate, of course"\n');
fs.writeFileSync(path.join(files, '4-european-semicolons.csv'), 'Term;Definition\nHund;Dog\nKatze;Cat, a small domestic animal\nHaus;House\n');
const ankiNotes = [
  { type: 'basic' as const, fields: ['What is the powerhouse of the cell?', 'The <b>mitochondrion</b>'], deck: 'Science::Cells' },
  { type: 'basic' as const, fields: ['Name this organ: <img src="heart.png">', 'The heart'], deck: 'Science::Anatomy' },
  { type: 'basic' as const, fields: ['Which bone is this? <img src="bone.png">', 'The femur<br>(thigh bone)'], deck: 'Science::Anatomy' },
  { type: 'cloze' as const, fields: ['The {{c1::nucleus}} stores {{c2::DNA}}.', 'Found in eukaryotes'], deck: 'Science::Cells' },
  { type: 'basic' as const, fields: ['Identify this cell: <img src="cell.png">', 'A plant cell'], deck: 'Science::Cells' },
];
const media = { 'heart.png': HEART, 'bone.png': BONE, 'cell.png': CELL };
fs.writeFileSync(
  path.join(files, '8-biology-notes-for-flashcards.txt'),
  '# Cell Structure\nThe cell is the basic unit of life and all living things are made of cells.\nNucleus: the control centre of the cell that stores the DNA.\nMitochondrion: the organelle that releases energy from glucose during respiration.\nRibosomes are the tiny structures where proteins are made.\nCell membrane - a thin layer that controls what enters and leaves the cell\n\n# Photosynthesis\nPhotosynthesis is the process plants use to turn light, water and carbon dioxide into glucose and oxygen.\nChlorophyll: the green pigment in chloroplasts that absorbs light energy.\nStomata are small pores on leaves that let gases in and out.\n\n# Genetics\nDNA: the molecule that carries genetic information in a double helix.\nA gene is a section of DNA that codes for one protein.\nAlleles - different versions of the same gene\n',
);
fs.writeFileSync(path.join(files, '5-anki-deck-newer-format.apkg'), buildApkg({ latest: true, notes: ankiNotes, media }));
fs.writeFileSync(path.join(files, '6-anki-deck-older-format.apkg'), buildApkg({ latest: false, notes: ankiNotes, media }));

// ---------------------------------------------------------------- demo account and cards
const accountFile = path.join(root, 'demo-account.json');
const account = fs.existsSync(accountFile)
  ? (JSON.parse(fs.readFileSync(accountFile, 'utf8')) as { email: string; password: string })
  : { email: 'demo@georgie.test', password: crypto.randomBytes(9).toString('base64url') };

async function main() {
  const login = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(account) });
  if (login.ok) {
    console.log('Demo account already exists; leaving your demo data as it is.');
    return;
  }
  const signup = await fetch(`${API}/auth/signup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...account, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }) });
  if (!signup.ok) throw new Error(`Could not create the demo account: ${await signup.text()}`);
  fs.writeFileSync(accountFile, JSON.stringify({ _note: 'Local preview only. Not committed to git.', ...account }, null, 2));
  const cookie = signup.headers.get('set-cookie')!.split(';')[0];

  const call = async (url: string, method = 'GET', body?: unknown) => {
    const res = await fetch(`${API}${url}`, { method, headers: { cookie, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    if (!res.ok) throw new Error(`${method} ${url}: ${await res.text()}`);
    return res.json();
  };
  const folder = async (name: string, parent?: number) => (await call('/folders', 'POST', { name, parent_id: parent })).folder.id as number;
  const card = async (f: number, front: string, back: string) => (await call(`/folders/${f}/cards`, 'POST', { front, back })).card.id as number;
  const picture = async (cardId: number, side: 'front' | 'back', bytes: Uint8Array) => {
    const form = new FormData();
    form.append('side', side);
    form.append('images', new Blob([Buffer.from(bytes)], { type: 'image/png' }), 'picture.png');
    const res = await fetch(`${API}/cards/${cardId}/images`, { method: 'POST', headers: { cookie }, body: form });
    if (!res.ok) throw new Error(await res.text());
  };

  const bio = await folder('Biology');
  const cells = await folder('Cells', bio);
  const anatomy = await folder('Anatomy', bio);
  await card(bio, 'What is photosynthesis?', 'How plants turn light, water and carbon dioxide into sugar and oxygen.');
  await card(bio, 'What does DNA stand for?', 'Deoxyribonucleic acid');
  for (const [q, a] of [
    ['What is the powerhouse of the cell?', 'The mitochondrion'],
    ['Which organelle makes proteins?', 'Ribosomes'],
    ['Where is DNA stored in a eukaryotic cell?', 'The nucleus'],
    ['What controls what enters and leaves a cell?', 'The cell membrane'],
  ]) await card(cells, q, a);
  await picture(await card(cells, 'Label this plant cell', 'The large green parts are chloroplasts.'), 'front', CELL);
  await picture(await card(anatomy, 'Name this organ', 'The heart: it pumps blood around the body.'), 'front', HEART);
  await picture(await card(anatomy, 'Which bone is the longest in the human body?', 'The femur (thigh bone)'), 'back', BONE);

  const spanish = await folder('Spanish');
  const verbs = await folder('Verbs', spanish);
  const food = await folder('Food', spanish);
  const verbCards: number[] = [];
  for (const [q, a] of [['comer', 'to eat'], ['hablar', 'to speak'], ['vivir', 'to live'], ['beber', 'to drink'], ['escribir', 'to write'], ['correr', 'to run']]) verbCards.push(await card(verbs, q, a));
  for (const [q, a] of [['la manzana', 'the apple'], ['el pan', 'the bread'], ['el queso', 'the cheese'], ['la leche', 'the milk']]) await card(food, q, a);
  await card(spanish, 'Buenos días', 'Good morning');
  await card(spanish, '¿Cómo estás?', 'How are you?');

  const history = await folder('History');
  for (const [q, a] of [
    ['Year of the first Moon landing?', '1969'],
    ['Who was the first Roman emperor?', 'Augustus'],
    ['In what year did the Titanic sink?', '1912'],
    ['Which wall fell in 1989?', 'The Berlin Wall'],
  ]) await card(history, q, a);

  const chem = await folder('Chemistry');
  for (const [q, a] of [['Symbol for gold?', 'Au'], ['Lightest element?', 'Hydrogen'], ['What is H2O?', 'Water']]) await card(chem, q, a);

  // Cards for trying "Type my answer": a missing accent, a near-miss, a wrong year, a fill-in-the-blank card (skips typing).
  const typing = await folder('Try typing');
  for (const [q, a] of [
    ['Capital of Italy?', 'Rome'],
    ['coffee (in Spanish)', 'café'],
    ['What does photosynthesis produce from light?', 'Plants turn light, water and carbon dioxide into sugar'],
    ['Year of the first Moon landing?', '1969'],
    ['The […] stores […].', 'The nucleus stores DNA.'],
    ['Powerhouse of the cell?', 'The mitochondrion\n(makes ATP)'],
  ]) await card(typing, q, a);

  // Put a few Spanish verbs at different stages, so Study shows learning, waiting and review cards.
  const rate = (cardId: number, rating: number) => call(`/study/${spanish}/rate`, 'POST', { cardId, rating });
  await rate(verbCards[0], 4); // Easy: graduates, due in 4 days
  await rate(verbCards[1], 3); // Good: 10 minute step
  await rate(verbCards[2], 2); // Medium: back in 5 minutes
  await rate(verbCards[3], 1); // Hard: back in 1 minute

  // A real Georgie export, to try importing it back.
  const csv = await fetch(`${API}/export.csv`, { headers: { cookie } });
  fs.writeFileSync(path.join(files, '7-georgie-export.csv'), Buffer.from(await csv.arrayBuffer()));
  console.log('Seeded the demo account (login saved to preview/demo-account.json) and wrote sample files to preview/sample-files.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
