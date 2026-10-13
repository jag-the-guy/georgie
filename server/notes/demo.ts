import { NotesError, type CardGenerator, type GenerateRequest, type GenerateResult, type GeneratedCard, type GeneratedTopic } from './types';

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => (clearTimeout(t), reject(new NotesError('Cancelled.', 499))), { once: true });
  });

const DEMO_WARNING =
  'Demo mode: no AI key is set up, so these cards were made by a simple rule-based demo, not by real AI. They are only here so you can try the screens. Add an Anthropic API key to turn on the real thing.';

const sentenceCase = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const words = (s: string) => s.trim().split(/\s+/).filter(Boolean);

function isHeading(line: string, next: string | undefined): boolean {
  const t = line.trim();
  if (/^#{1,6}\s+\S/.test(t)) return true;
  return t.length > 0 && t.length <= 60 && words(t).length <= 8 && !/[.!?:;,]$/.test(t) && /^[A-Z0-9]/.test(t) && !!next?.trim() && next.trim().length > t.length;
}

/** A few rules that find "Term: definition" and "X is Y" patterns. Nothing like real AI; just enough to show the screens. */
function cardsFromLine(line: string): GeneratedCard[] {
  const t = line.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').trim();
  if (t.length < 12) return [];
  let m = /^([^:–—-]{2,50}?)\s*(?::|\s[–—-]\s)\s*(.{8,})$/.exec(t);
  if (m && words(m[1]).length <= 5) return [{ front: `What is ${m[1].trim()}?`, back: sentenceCase(m[2].trim()) }];
  m = /^(.{3,60}?)\s+(is|are|means|refers to|is defined as|is called)\s+(.{8,})$/i.exec(t);
  if (m && words(m[1]).length <= 6 && !/^(this|that|it|there|these|those)$/i.test(m[1].trim())) {
    const verb = m[2].toLowerCase() === 'are' ? 'are' : 'is';
    const subject = m[1].trim().replace(/^(The|A|An)\s/, (a) => a.toLowerCase());
    return [{ front: `What ${verb} ${subject}?`, back: `${sentenceCase(m[3].replace(/[.]$/, '').trim())}.` }];
  }
  return [];
}

export class DemoGenerator implements CardGenerator {
  readonly mode = 'demo' as const;
  readonly model = undefined;
  constructor(private readonly pause = 1500) {}

  async generate({ parts, signal, onProgress }: GenerateRequest): Promise<GenerateResult> {
    onProgress({ stage: 'Reading your notes… (demo mode)' });
    await sleep(this.pause, signal);

    const text = parts.filter((p) => p.kind === 'text').map((p) => (p as { text: string }).text).join('\n\n');
    const warnings = [DEMO_WARNING];

    if (!text.trim()) {
      onProgress({ stage: 'Writing sample flashcards…', cards: 3 });
      await sleep(this.pause, signal);
      warnings.push("Demo mode can't read PDFs or pictures, so these are placeholder cards. With an AI key, the real thing reads them properly.");
      return {
        subject: 'Demo cards',
        summary: `Placeholder cards for ${parts.map((p) => p.name).join(', ')}.`,
        topics: [
          {
            name: 'Demo topic',
            cards: [
              { front: 'This is a demo card. What will real AI do with your notes?', back: 'Read them in depth, work out the subject, and write cards that test real understanding.' },
              { front: 'Why are you seeing placeholder cards?', back: 'No AI key is set up yet, and demo mode can only read plain text.' },
              { front: 'How do you turn the real AI on?', back: 'Add an Anthropic API key (ANTHROPIC_API_KEY) to the server settings.' },
            ],
          },
        ],
        mode: 'demo',
        warnings,
      };
    }

    const lines = text.split(/\r?\n/);
    const topics: GeneratedTopic[] = [];
    let current: GeneratedTopic = { name: 'Your notes', cards: [] };
    let title = '';
    let made = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line.trim()) continue;
      if (isHeading(line, lines.slice(i + 1).find((l) => l.trim()))) {
        if (current.cards.length > 0) topics.push(current);
        const name = line.replace(/^#{1,6}\s+/, '').trim().slice(0, 60);
        title ||= name;
        current = { name, cards: [] };
        continue;
      }
      // Each sentence on its own line, so long paragraphs also produce cards.
      for (const sentence of line.split(/(?<=[.!?])\s+(?=[A-Z])/)) {
        for (const c of cardsFromLine(sentence)) {
          if (current.cards.length < 15) {
            current.cards.push(c);
            made++;
          }
        }
      }
      if (made % 3 === 0) onProgress({ stage: 'Writing flashcards… (demo mode)', cards: made });
    }
    if (current.cards.length > 0) topics.push(current);

    if (topics.length === 0) {
      // Nothing matched a pattern: fall back to one "what did this say" card per paragraph.
      const paragraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter((p) => p.length > 40).slice(0, 8);
      topics.push({
        name: 'Your notes',
        cards: paragraphs.map((p) => ({ front: `Summarise this passage: "${p.slice(0, 60).trim()}…"`, back: p.slice(0, 400) })),
      });
      warnings.push("The demo only recognises simple patterns like “Term: definition” and “X is Y”, and couldn't find many in these notes.");
    }
    if (topics.every((t) => t.cards.length === 0)) throw new NotesError('The demo could not find anything to make cards from. Try notes with lines like “Term: definition”.', 422);

    onProgress({ stage: 'Writing flashcards… (demo mode)', cards: topics.reduce((n, t) => n + t.cards.length, 0) });
    await sleep(this.pause / 2, signal);
    return {
      subject: title || 'Your notes',
      summary: `${topics.length} ${topics.length === 1 ? 'section' : 'sections'} of text turned into practice cards by the demo.`,
      topics,
      mode: 'demo',
      warnings,
    };
  }
}
