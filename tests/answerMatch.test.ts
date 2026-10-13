import { describe, expect, it } from 'vitest';
import { acceptableAnswers, canTypeAnswer, checkAnswer, editDistance, fold, MESSAGES, normalize, pickMessage, suggestedRating, type Verdict } from '../shared/answerMatch';

const verdict = (typed: string, expected: string) => checkAnswer(typed, expected).verdict;

describe('what counts as a correct answer', () => {
  const correct: [string, string][] = [
    ['mitochondrion', 'mitochondrion'],
    ['MITOCHONDRION!!', 'mitochondrion'],
    ['  the   mitochondrion ', 'The mitochondrion'],
    ['mitochondrion', 'The mitochondrion'], // the little word is optional
    ['powerhouse of the cell', 'The powerhouse of the cell'],
    ['mitochondrian', 'The mitochondrion'], // one typo in a long word
    ['augustis', 'Augustus'], // one typo in an 8-letter word
    ['eat', 'to eat'],
    ['to eat', 'to eat\n(regular -er verb)'], // the notes in brackets are optional
    ['eat', 'to eat\n(regular -er verb)'],
    ['the heart', 'The heart (pumps blood)'],
    ['the heart', 'The heart\nIt pumps blood around the body.'], // the first line is the answer, the rest is explanation
    ['color', 'colour / color'], // alternatives
    ['hound', 'dog; hound'],
    ['dog', 'dog | hound'],
    ['pan', 'el pan'],
    ['the apple', 'apple'], // extra little words are fine
    ['mother in law', 'mother-in-law'],
    ['dont', "don't"],
    ['rock and roll', 'rock & roll'],
    ['division cell', 'cell division'], // word order doesn't matter
    ['1969', '1969'],
    ['犬', '犬'],
    ['the', 'the'],
  ];
  it.each(correct)('"%s" is correct for "%s"', (typed, expected) => {
    expect(verdict(typed, expected)).toBe('correct');
  });
});

describe('what counts as almost', () => {
  const almost: [string, string][] = [
    ['hoal', 'hola'], // a swap in a short word
    ['la queso', 'el queso'], // the right word with the wrong little word
    ['plants turn light into sugar', 'Plants turn light, water and carbon dioxide into sugar'], // most key words, some missing
    ['hello friend', 'hello'], // the right word plus extra
    ['mitocondria', 'mitochondrion'], // three slips in a long word
  ];
  it.each(almost)('"%s" is almost right for "%s"', (typed, expected) => {
    expect(verdict(typed, expected)).toBe('almost');
  });

  it('says which important words were missing', () => {
    const r = checkAnswer('plants turn light into sugar', 'Plants turn light, water and carbon dioxide into sugar');
    expect(r.verdict).toBe('almost');
    expect(r.missing).toEqual(['water', 'carbon', 'dioxide']);
  });
  it('only lists missing words for an "almost"', () => {
    expect(checkAnswer('banana', 'carbon dioxide').missing).toEqual([]);
    expect(checkAnswer('carbon dioxide', 'carbon dioxide').missing).toEqual([]);
  });
});

describe('what counts as wrong', () => {
  const wrong: [string, string][] = [
    ['', 'mitochondrion'],
    ['   ', 'mitochondrion'],
    ['...', 'mitochondrion'],
    ['ribosomes', 'mitochondrion'],
    ['nucleus', 'The mitochondrion'],
    ['cat', 'car'], // too short to forgive a typo
    ['dos', 'dog'],
    ['a', 'b'],
    ['1968', '1969'], // numbers must be exact
    ['1', '2'],
    ['to', 'to eat'], // only a little word
    ['dioxide', 'carbon dioxide'], // only half of it
    ['猫', '犬'],
    ['the', 'the heart'],
    ['I have no idea', 'The mitochondrion'],
  ];
  it.each(wrong)('"%s" is wrong for "%s"', (typed, expected) => {
    expect(verdict(typed, expected)).toBe('wrong');
  });

  it('a long answer with a number needs the number right', () => {
    expect(verdict('The Moon landing was in 1968', 'The Moon landing was in 1969')).toBe('wrong');
    expect(verdict('The Moon landing was in 1969', 'The Moon landing was in 1969')).toBe('correct');
  });
});

describe('accents', () => {
  it('missing accents are right, with a note showing how to write the word', () => {
    expect(checkAnswer('cafe', 'café')).toMatchObject({ verdict: 'correct', accentNotes: ['café'] });
    expect(checkAnswer('ano', 'año')).toMatchObject({ verdict: 'correct', accentNotes: ['año'] });
    expect(checkAnswer('cafè', 'café')).toMatchObject({ verdict: 'correct', accentNotes: ['café'] });
  });
  it('only mentions the words that were missing accents', () => {
    expect(checkAnswer('el cafe es bueno', 'el café es bueno').accentNotes).toEqual(['café']);
    expect(checkAnswer('el café es bueno', 'el café es bueno').accentNotes).toEqual([]);
  });
  it('no note when the accents are right', () => {
    expect(checkAnswer('café', 'café').accentNotes).toEqual([]);
  });
});

describe('the pieces', () => {
  it('normalises', () => {
    expect(normalize("  Don't  STOP!  ")).toBe('dont stop');
    expect(normalize('mother-in-law')).toBe('mother in law');
    expect(normalize('Café')).toBe('café');
    expect(fold('café año Zürich')).toBe('cafe ano Zurich');
  });
  it('measures typos, counting a swapped pair as one', () => {
    expect(editDistance('hola', 'hola')).toBe(0);
    expect(editDistance('hola', 'hoal')).toBe(1);
    expect(editDistance('cat', 'cart')).toBe(1);
    expect(editDistance('kitten', 'sitting')).toBe(3);
    expect(editDistance('', 'abc')).toBe(3);
  });
  it('finds the legitimate shorter forms of an answer', () => {
    const a = acceptableAnswers('to eat\n(regular -er verb)');
    expect(a).toContain('to eat\n(regular -er verb)');
    expect(a.map((s) => s.trim())).toContain('to eat');
    expect(acceptableAnswers('dog; hound').map((s) => s.trim())).toEqual(expect.arrayContaining(['dog; hound', 'dog', 'hound']));
    expect(acceptableAnswers('   ')).toEqual([]);
  });
});

describe('which cards can be answered by typing', () => {
  it('needs some text on the back', () => {
    expect(canTypeAnswer('Capital of France?', 'Paris')).toBe(true);
    expect(canTypeAnswer('Year?', '1969')).toBe(true);
    expect(canTypeAnswer('Name this organ', '')).toBe(false); // the answer is a picture
    expect(canTypeAnswer('Name this organ', '  —  ')).toBe(false);
  });
  it('skips fill-in-the-blank cards, whose back is the whole sentence', () => {
    expect(canTypeAnswer('The […] stores […].', 'The nucleus stores DNA.')).toBe(false);
    expect(canTypeAnswer('The [...] is a star', 'The sun is a star')).toBe(false);
  });
});

describe('messages and suggestions', () => {
  it('has several messages for every result', () => {
    for (const v of ['correct', 'almost', 'wrong'] as Verdict[]) expect(new Set(MESSAGES[v]).size).toBeGreaterThanOrEqual(4);
    expect(MESSAGES.wrong.length).toBeGreaterThanOrEqual(6);
  });
  it('never shows the same message twice in a row, however the dice fall', () => {
    for (const v of ['correct', 'almost', 'wrong'] as Verdict[]) {
      for (const previous of MESSAGES[v]) {
        for (const roll of [0, 0.25, 0.5, 0.75, 0.9999999]) {
          const m = pickMessage(v, previous, () => roll);
          expect(MESSAGES[v]).toContain(m);
          expect(m).not.toBe(previous);
        }
      }
    }
  });
  it('really does vary', () => {
    const seen = new Set<string>();
    let last: string | undefined;
    for (let i = 0; i < 200; i++) seen.add((last = pickMessage('wrong', last)));
    expect(seen.size).toBe(MESSAGES.wrong.length);
  });
  it('wrong-answer messages are kind, and say it was not right', () => {
    for (const m of MESSAGES.wrong) expect(m).toMatch(/not|wasn’t|wrong|miss|tricky/i);
  });
  it('suggests a rating but never chooses one', () => {
    expect(suggestedRating('correct')).toBe(3);
    expect(suggestedRating('almost')).toBe(2);
    expect(suggestedRating('wrong')).toBe(1);
  });
});

describe('speed', () => {
  it('checks long answers instantly', () => {
    const letters = (i: number) => String.fromCharCode(97 + Math.floor(i / 26), 97 + (i % 26)); // aa, ab, ac...
    const long = Array.from({ length: 300 }, (_, i) => `word${letters(i)}`).join(' ');
    const t0 = performance.now();
    expect(verdict(long, long)).toBe('correct');
    expect(verdict(long.replace('wordkk', 'wrodkk'), long)).not.toBe('wrong');
    expect(performance.now() - t0).toBeLessThan(500);
  });
});
