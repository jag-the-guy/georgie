import { HttpError } from '../http';

export type Density = 'light' | 'standard' | 'thorough';

export interface NotesOptions {
  density: Density;
  /** Optional: what the student wants the cards to concentrate on. */
  focus?: string;
}

/** One piece of the student's notes, ready to hand to the AI. */
export type InputPart =
  | { kind: 'text'; name: string; text: string }
  | { kind: 'pdf'; name: string; data: Buffer }
  | { kind: 'image'; name: string; mime: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'; data: Buffer };

export interface GeneratedCard {
  front: string;
  back: string;
}
export interface GeneratedTopic {
  name: string;
  cards: GeneratedCard[];
}
export interface GeneratedNotes {
  /** What the notes are about, e.g. "Biology: cell structure". */
  subject: string;
  summary: string;
  topics: GeneratedTopic[];
}

export interface GenerateRequest {
  parts: InputPart[];
  options: NotesOptions;
  signal: AbortSignal;
  /** Tell the screen what is happening; `cards` is the running count while cards are being written. */
  onProgress: (progress: { stage: string; cards?: number }) => void;
}

export interface GenerateResult extends GeneratedNotes {
  mode: 'claude' | 'demo';
  model?: string;
  /** Shown to the user, e.g. "The AI ran out of room, so only part of the notes were converted." */
  warnings: string[];
  usage?: { inputTokens: number; outputTokens: number };
}

export interface CardGenerator {
  mode: 'claude' | 'demo';
  model?: string;
  generate(req: GenerateRequest): Promise<GenerateResult>;
}

/** An error whose message is safe and useful to show to the person using the app. */
export class NotesError extends HttpError {
  constructor(message: string, status = 400) {
    super(status, message);
  }
}

export const LIMITS = {
  maxFiles: 6,
  /** PDFs and pictures are sent as base64 inside a 32 MB request, so keep the raw total comfortably below that. */
  maxBinaryBytes: 20 * 1024 * 1024,
  maxImageBytes: 5 * 1024 * 1024,
  maxTextChars: 400_000,
  maxCards: 400,
  maxFocusChars: 500,
};
