/**
 * Checks that your Anthropic API key works and that "Turn notes into flashcards" can reach Claude.
 *
 *   npx tsx scripts/check-ai.ts
 *
 * Reads ANTHROPIC_API_KEY from your .env file. It makes ONE small real request (a few cents at most) and prints the
 * cards it made, how many tokens it used, and the approximate cost. Nothing is saved anywhere.
 */
import path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { loadDotEnv } from '../server/env';
import { ClaudeGenerator, DEFAULT_MODEL, explainApiError, type ClaudeClientLike } from '../server/notes/claude';

loadDotEnv(path.join(import.meta.dirname, '..', '.env'));
const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
if (!apiKey) {
  console.error('No ANTHROPIC_API_KEY found. Put it in the .env file (see .env.example), then run this again.');
  process.exit(1);
}
const model = process.env.NOTES_AI_MODEL?.trim() || DEFAULT_MODEL;
console.log(`Asking ${model} to make flashcards from a short sample...`);

const notes = `Photosynthesis
Photosynthesis is the process plants use to turn light, water and carbon dioxide into glucose and oxygen.
Chlorophyll is the green pigment in chloroplasts that absorbs light energy.
Stomata are small pores on leaves that let gases in and out.`;

try {
  const generator = new ClaudeGenerator({ client: new Anthropic({ apiKey }) as unknown as ClaudeClientLike, model });
  const result = await generator.generate({
    parts: [{ kind: 'text', name: 'sample.txt', text: notes }],
    options: { density: 'light' },
    signal: new AbortController().signal,
    onProgress: () => {},
  });
  console.log(`\nIt works. Subject detected: "${result.subject}"`);
  for (const topic of result.topics) {
    console.log(`\n  ${topic.name}`);
    for (const c of topic.cards) console.log(`    Q: ${c.front}\n    A: ${c.back}`);
  }
  if (result.usage) {
    const perMillion = model.includes('sonnet') ? { in: 2, out: 10 } : model.includes('haiku') ? { in: 0.1, out: 0.5 } : { in: 4, out: 20 };
    const cost = (result.usage.inputTokens * perMillion.in + result.usage.outputTokens * perMillion.out) / 1_000_000;
    console.log(`\nUsed ${result.usage.inputTokens} input and ${result.usage.outputTokens} output tokens: about $${cost.toFixed(4)}.`);
  }
} catch (err) {
  console.error('\nThat did not work:', explainApiError(err).message);
  process.exit(1);
}
