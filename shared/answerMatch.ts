/**
 * Checks what someone typed against the back of a card, forgivingly:
 *  - capitals, punctuation and extra spaces never matter
 *  - small typos are forgiven (more for longer words; none for short words or numbers)
 *  - word order doesn't matter, and little words ("the", "to", "el"...) matter less
 *  - a missing accent counts as right, with a gentle note
 *  - "(extra notes)" in brackets, a first line, or alternatives split by ; / | can each stand alone
 * Pure functions, so they can be tested exhaustively and run in the browser.
 */

export type Verdict = 'correct' | 'almost' | 'wrong';

export interface AnswerCheck {
  verdict: Verdict;
  /** 0 to 1: how close the best match was. */
  score: number;
  /** Words typed without their accent, shown as they should be written: ["café"]. */
  accentNotes: string[];
  /** Important words from the answer that were missing (shown when the result is "almost"). */
  missing: string[];
}

const STOPWORDS = new Set(
  (
    'a an the to of and or is are was were be been it its in on at for with as by from that this these those ' +
    'el la los las un una unos unas de del al y o es son en con por para que lo ' +
    'le les des du et est sont dans ' +
    'der die das ein eine und ist sind mit von zu im'
  ).split(' '),
);

const rank: Record<Verdict, number> = { wrong: 0, almost: 1, correct: 2 };

// ---------------------------------------------------------------------------------------------
// Normalising
// ---------------------------------------------------------------------------------------------

/** Lower case, no punctuation, single spaces. Keeps accents. */
export function normalize(s: string): string {
  return s
    .normalize('NFC')
    .toLowerCase()
    .replace(/['’‘`´]/g, '') // don't = dont
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ') // hyphens and punctuation become spaces: mother-in-law = mother in law
    .replace(/\s+/g, ' ')
    .trim();
}

/** Also removes accents: café -> cafe, año -> ano. */
export function fold(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').normalize('NFC');
}

const tokensOf = (s: string) => (s === '' ? [] : s.split(' '));
const hasDigit = (s: string) => /\p{N}/u.test(s);

/** Edit distance counting a swap of two neighbouring letters as one mistake (hoal -> hola). */
export function editDistance(a: string, b: string): number {
  const x = [...a];
  const y = [...b];
  const d: number[][] = Array.from({ length: x.length + 1 }, (_, i) => [i, ...Array(y.length).fill(0)]);
  for (let j = 0; j <= y.length; j++) d[0][j] = j;
  for (let i = 1; i <= x.length; i++) {
    for (let j = 1; j <= y.length; j++) {
      const cost = x[i - 1] === y[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && x[i - 1] === y[j - 2] && x[i - 2] === y[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[x.length][y.length];
}

/** How many typos a word of this length may contain and still count as the same word. */
const typoAllowance = (len: number) => (len < 5 ? 0 : len < 10 ? 1 : len < 20 ? 2 : 3);

// ---------------------------------------------------------------------------------------------
// The answers we accept: the whole back, plus its legitimate shorter forms
// ---------------------------------------------------------------------------------------------

export function acceptableAnswers(expected: string): string[] {
  const out = new Set<string>();
  const withoutNotes = expected.replace(/\([^)]*\)|\[[^\]]*\]/g, ' ');
  const firstLine = (s: string) => s.split(/\n+/).find((l) => /[\p{L}\p{N}]/u.test(l)) ?? s;
  for (const text of [expected, withoutNotes]) {
    out.add(text);
    // The main answer is usually the first line; later lines are explanation.
    const main = firstLine(text);
    out.add(main);
    for (const alt of main.split(/\s*[;|/]\s*/)) out.add(alt);
    for (const alt of text.split(/\s*[;|/]\s*/)) out.add(alt);
  }
  return [...out].filter((s) => /[\p{L}\p{N}]/u.test(s));
}

// ---------------------------------------------------------------------------------------------
// Comparing against one acceptable answer
// ---------------------------------------------------------------------------------------------

interface Candidate {
  verdict: Verdict;
  score: number;
  accentNotes: string[];
  missing: string[];
}

const WRONG: Candidate = { verdict: 'wrong', score: 0, accentNotes: [], missing: [] };

function compare(typed: string, answer: string): Candidate {
  const tN = normalize(typed);
  const aN = normalize(answer);
  if (!tN || !aN) return WRONG;
  const tF = fold(tN);
  const aF = fold(aN);
  const tTok = tokensOf(tN);
  const aTok = tokensOf(aN);
  const tFTok = tokensOf(tF);
  const aFTok = tokensOf(aF);

  // Accent differences, for the gentle note.
  const accentNotes: string[] = [];
  const noteAccents = (typedIdx: number, answerIdx: number) => {
    if (tTok[typedIdx] !== aTok[answerIdx] && tFTok[typedIdx] === aFTok[answerIdx]) accentNotes.push(aTok[answerIdx]);
  };

  if (tF === aF) {
    if (tN !== aN) aTok.forEach((_, i) => noteAccents(i, i));
    return { verdict: 'correct', score: 1, accentNotes, missing: [] };
  }

  // Whole-string comparison: catches typos in single words and in short phrases.
  let best: Candidate = WRONG;
  if (!hasDigit(aF) && !hasDigit(tF)) {
    const dist = editDistance(tF, aF);
    const len = Math.max(tF.length, aF.length);
    const score = 1 - dist / len;
    const allowed = aF.length < 5 ? 0 : typoAllowance(aF.length);
    if (dist <= allowed) best = { verdict: 'correct', score, accentNotes: [], missing: [] };
    else if (aF.length >= 4 && (dist <= allowed + 1 || score >= 0.78)) best = { verdict: 'almost', score, accentNotes: [], missing: [] };
  }
  if (aTok.length === 1 && tTok.length === 1) return best;

  // Word-by-word comparison: ignores word order, forgives typos in longer words, weighs little words less.
  const isStop = (w: string) => STOPWORDS.has(w);
  const usedTyped = new Set<number>();
  const matchedAnswer = new Map<number, { typedIdx: number; credit: number }>();
  const tryMatch = (exactOnly: boolean) => {
    aFTok.forEach((aw, ai) => {
      if (matchedAnswer.has(ai)) return;
      for (let ti = 0; ti < tFTok.length; ti++) {
        if (usedTyped.has(ti)) continue;
        const tw = tFTok[ti];
        const same = tw === aw;
        const close = !exactOnly && !same && !hasDigit(aw) && !hasDigit(tw) && aw.length >= 5 && editDistance(tw, aw) <= typoAllowance(aw.length);
        if (same || close) {
          usedTyped.add(ti);
          matchedAnswer.set(ai, { typedIdx: ti, credit: same ? 1 : 0.9 });
          return;
        }
      }
    });
  };
  tryMatch(true);
  tryMatch(false);

  const contentIdx = aFTok.map((w, i) => i).filter((i) => !isStop(aFTok[i]));
  const recallIdx = contentIdx.length > 0 ? contentIdx : aFTok.map((_, i) => i); // all little words? then they all count
  const recall = recallIdx.reduce((n, i) => n + (matchedAnswer.get(i)?.credit ?? 0), 0) / recallIdx.length;

  const weight = (w: string) => (isStop(w) ? 0.3 : 1);
  const typedTotal = tFTok.reduce((n, w) => n + weight(w), 0);
  const typedMatched = [...matchedAnswer.values()].reduce((n, m) => n + weight(tFTok[m.typedIdx]), 0);
  const precision = typedTotal === 0 ? 0 : typedMatched / typedTotal;

  let verdict: Verdict = recall >= 0.9 && precision >= 0.7 ? 'correct' : recall >= 0.6 && precision >= 0.5 ? 'almost' : 'wrong';

  // A number or year that's missing or different means the fact itself is wrong, however many other words match.
  if (aFTok.some((w, i) => hasDigit(w) && !matchedAnswer.has(i))) verdict = 'wrong';

  // "la queso" for "el queso": the little words are both there but different (a gender or article slip), so not fully right.
  const aStops = new Set(aFTok.filter(isStop));
  const tStops = new Set(tFTok.filter(isStop));
  if (verdict === 'correct' && aStops.size > 0 && tStops.size > 0 && ![...tStops].some((w) => aStops.has(w))) verdict = 'almost';

  if (verdict === 'wrong' && rank[best.verdict] === 0) return WRONG;
  const wordScore = recall * Math.min(1, precision + 0.15);
  if (rank[verdict] < rank[best.verdict] || (rank[verdict] === rank[best.verdict] && best.score >= wordScore)) return best;

  const notes: string[] = [];
  matchedAnswer.forEach((m, ai) => {
    if (tTok[m.typedIdx] !== aTok[ai] && tFTok[m.typedIdx] === aFTok[ai]) notes.push(aTok[ai]);
  });
  const missing = recallIdx.filter((i) => !matchedAnswer.has(i)).map((i) => aTok[i]);
  return { verdict, score: wordScore, accentNotes: notes, missing };
}

// ---------------------------------------------------------------------------------------------
// The public check
// ---------------------------------------------------------------------------------------------

export function checkAnswer(typed: string, expected: string): AnswerCheck {
  let best: Candidate = WRONG;
  for (const answer of acceptableAnswers(expected)) {
    const c = compare(typed, answer);
    if (rank[c.verdict] > rank[best.verdict] || (rank[c.verdict] === rank[best.verdict] && c.score > best.score)) best = c;
    if (best.verdict === 'correct' && best.score === 1) break;
  }
  return { verdict: best.verdict, score: Math.round(best.score * 100) / 100, accentNotes: [...new Set(best.accentNotes)], missing: best.verdict === 'almost' ? best.missing.slice(0, 4) : [] };
}

/** Cards where typing doesn't make sense: nothing written on the back, or a fill-in-the-blank card. */
export function canTypeAnswer(front: string, back: string): boolean {
  if (!/[\p{L}\p{N}]/u.test(back)) return false;
  if (/\[…\]|\[\.\.\.\]/.test(front)) return false; // cloze cards import as "The […] is a star." with the whole sentence on the back
  return true;
}

// ---------------------------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------------------------

export const MESSAGES: Record<Verdict, string[]> = {
  correct: [
    'You got it right!',
    'Spot on! That’s exactly it.',
    'Nailed it!',
    'Yes! You knew that one.',
    'Correct, well done!',
    'Perfect, that’s the answer.',
  ],
  almost: [
    'Almost there! You were very close.',
    'So close! Just a little off.',
    'Nearly! Look at the small difference below.',
    'Good try, you’re almost there.',
  ],
  wrong: [
    'Not quite this time, but every miss helps it stick.',
    'That wasn’t it, but you’ll know it next time.',
    'Not this time, and that’s completely fine. Now you’ve seen it.',
    'Wrong answer, right attitude! Check it below and it will come back soon.',
    'Not quite. The ones you miss are the ones you learn the most from.',
    'That wasn’t the one, but keep going, you’re building it up.',
    'Not this time. Take a look at the answer, it will stick better now.',
    'Tricky one! It’ll come back round so you get another go.',
  ],
};

/** A random message for the result, never the same one twice in a row. */
export function pickMessage(verdict: Verdict, previous?: string, random: () => number = Math.random): string {
  const options = MESSAGES[verdict].filter((m) => m !== previous);
  return options[Math.min(options.length - 1, Math.floor(random() * options.length))];
}

/** Which rating button to highlight as a suggestion. 1 Hard, 2 Medium, 3 Good, 4 Easy. */
export const suggestedRating = (verdict: Verdict): 1 | 2 | 3 => (verdict === 'correct' ? 3 : verdict === 'almost' ? 2 : 1);
