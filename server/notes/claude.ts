import Anthropic from '@anthropic-ai/sdk';
import { instructionsFor, OUTPUT_SCHEMA, SYSTEM_PROMPT, salvageTruncatedJson, tidyGenerated } from './prompt';
import { NotesError, type CardGenerator, type GenerateRequest, type GenerateResult, type InputPart, type NotesOptions } from './types';

export const DEFAULT_MODEL = 'claude-opus-5-5';

/** The small part of the Anthropic client we use, so tests can stand in a fake. */
export interface StreamLike {
  on(event: 'text', listener: (delta: string, snapshot: string) => void): unknown;
  finalMessage(): Promise<{
    stop_reason: string | null;
    content: { type: string; text?: string }[];
    usage?: { input_tokens: number; output_tokens: number };
  }>;
}
export interface ClaudeClientLike {
  beta: { messages: { stream(params: Record<string, unknown>, options?: { signal?: AbortSignal }): StreamLike } };
}

/** The message content: the notes (each labelled by file name), then the instructions. */
export function buildContent(parts: InputPart[], options: NotesOptions): Anthropic.Beta.BetaContentBlockParam[] {
  const blocks: Anthropic.Beta.BetaContentBlockParam[] = [];
  for (const part of parts) {
    if (part.kind === 'text') {
      blocks.push({ type: 'text', text: `Notes from "${part.name}":\n\n${part.text}` });
    } else if (part.kind === 'pdf') {
      blocks.push({ type: 'text', text: `Notes from "${part.name}" (PDF):` });
      blocks.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: part.data.toString('base64') } });
    } else {
      blocks.push({ type: 'text', text: `Notes from "${part.name}" (a picture of notes):` });
      blocks.push({ type: 'image', source: { type: 'base64', media_type: part.mime, data: part.data.toString('base64') } });
    }
  }
  blocks.push({ type: 'text', text: instructionsFor(options) });
  return blocks;
}

export class ClaudeGenerator implements CardGenerator {
  readonly mode = 'claude' as const;
  constructor(
    private readonly opts: { client: ClaudeClientLike; model?: string },
  ) {}
  get model() {
    return this.opts.model ?? DEFAULT_MODEL;
  }

  async generate({ parts, options, signal, onProgress }: GenerateRequest): Promise<GenerateResult> {
    onProgress({ stage: 'Reading and understanding your notes…' });

    const stream = this.opts.client.beta.messages.stream(
      {
        model: this.model,
        max_tokens: 48_000,
        // If the AI's safety checks decline a request, Anthropic retries it on another model automatically.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        thinking: { type: 'adaptive' },
        output_config: { effort: 'high', format: { type: 'json_schema', schema: OUTPUT_SCHEMA } },
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: buildContent(parts, options) }],
      },
      { signal },
    );

    let counted = 0;
    let lastCountedAt = 0;
    stream.on('text', (_delta, snapshot) => {
      // Recount "front" keys every few KB: cheap, and gives the screen a live "N cards so far".
      if (snapshot.length - lastCountedAt < 1500 && counted > 0) return;
      lastCountedAt = snapshot.length;
      counted = (snapshot.match(/"front"\s*:/g) ?? []).length;
      onProgress({ stage: 'Writing flashcards…', cards: counted });
    });

    let message;
    try {
      message = await stream.finalMessage();
    } catch (err) {
      throw explainApiError(err, signal);
    }

    if (message.stop_reason === 'refusal') {
      throw new NotesError(
        "The AI declined to work with these notes. It can occasionally be over-cautious with some subjects (for example detailed biology or chemistry). Try fewer pages, or a smaller part of the notes.",
        422,
      );
    }
    const text = message.content.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('');
    const warnings: string[] = [];
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      raw = message.stop_reason === 'max_tokens' ? salvageTruncatedJson(text) : null;
      if (raw === null) {
        throw new NotesError(
          message.stop_reason === 'max_tokens'
            ? 'These notes are too big to turn into cards in one go. Try fewer pages at a time.'
            : 'The AI sent back something unexpected. Please try again.',
          502,
        );
      }
      warnings.push('The AI ran out of room before finishing, so only part of your notes were turned into cards. Try fewer pages at a time to cover everything.');
    }

    const { notes, trimmed } = tidyGenerated(raw);
    if (trimmed) warnings.push('There were more cards than Georgie can import in one go, so only the first ones are shown. Run the rest of your notes separately.');
    return {
      ...notes,
      mode: 'claude',
      model: this.model,
      warnings,
      usage: message.usage ? { inputTokens: message.usage.input_tokens, outputTokens: message.usage.output_tokens } : undefined,
    };
  }
}

/** Turns the many ways the AI service can fail into one clear sentence for the person using the app. */
export function explainApiError(err: unknown, signal?: AbortSignal): Error {
  if (err instanceof NotesError) return err;
  if (signal?.aborted || (err instanceof Error && (err.name === 'AbortError' || err.constructor.name === 'APIUserAbortError'))) {
    return new NotesError('Cancelled.', 499);
  }
  if (err instanceof Anthropic.AuthenticationError) {
    return new NotesError("The AI service didn't accept the server's API key. (For the owner: check ANTHROPIC_API_KEY.)", 502);
  }
  if (err instanceof Anthropic.PermissionDeniedError) {
    return new NotesError("The server's AI key isn't allowed to use this model. (For the owner: check NOTES_AI_MODEL and your Anthropic account.)", 502);
  }
  if (err instanceof Anthropic.RateLimitError) {
    return new NotesError('The AI is busy right now. Please wait a minute and try again.', 503);
  }
  if (err instanceof Anthropic.BadRequestError) {
    const message = String(err.message ?? '').toLowerCase();
    if (message.includes('credit balance')) return new NotesError('The AI account has run out of credit. (For the owner: add credit at console.anthropic.com.)', 502);
    if (message.includes('too long') || message.includes('maximum') || message.includes('page') || message.includes('too large')) {
      return new NotesError('These notes are too long for the AI to read in one go. Try fewer pages or fewer files.', 422);
    }
    return new NotesError("The AI couldn't read one of the files. Try saving it again, or as a PDF.", 422);
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return new NotesError("Couldn't reach the AI service. Check the internet connection and try again.", 503);
  }
  if (err instanceof Anthropic.APIError && (err.status === 529 || (err.status ?? 0) >= 500)) {
    return new NotesError('The AI service is overloaded right now. Please try again in a few minutes.', 503);
  }
  if (err instanceof Anthropic.APIError && err.status === 413) {
    return new NotesError('Those files are too big for the AI to accept. Try fewer or smaller files.', 413);
  }
  console.error('Unexpected error while making flashcards:', err instanceof Error ? err.message : err);
  return new NotesError('Something went wrong while making the flashcards. Please try again.', 500);
}
