import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import type { DB } from '../db';
import { HttpError, parse } from '../http';
import type { User } from '../auth';
import { readNotes } from '../notes/extract';
import { explainApiError } from '../notes/claude';
import { JobStore } from '../notes/jobs';
import { refundQuota, takeQuota, usedToday } from '../notes/quota';
import { LIMITS, NotesError, type CardGenerator } from '../notes/types';

export interface NotesDeps {
  db: DB;
  generator: CardGenerator;
  /** Who may use the feature (it costs money, so it's off unless switched on for you). */
  allowed: (user: User) => boolean;
  dailyLimit: number;
  now?: () => number;
}

const optionsSchema = z.object({
  density: z.enum(['light', 'standard', 'thorough']).default('standard'),
  focus: z.string().max(LIMITS.maxFocusChars).optional().default(''),
  text: z.string().max(LIMITS.maxTextChars).optional().default(''),
});

/** "Turn your notes into flashcards": upload notes, an AI reads them, you review the cards and import them. */
export function notesRouter(deps: NotesDeps) {
  const { db, generator, allowed, dailyLimit } = deps;
  const now = deps.now ?? Date.now;
  const router = Router();
  const jobs = new JobStore();

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: LIMITS.maxBinaryBytes + 1024 * 1024, files: LIMITS.maxFiles, fieldSize: 2 * 1024 * 1024, fields: 10 },
  }).array('files', LIMITS.maxFiles);

  const requireAccess = (user: User) => {
    if (!allowed(user)) throw new HttpError(403, "Turning notes into flashcards isn't switched on for your account.");
  };

  router.get('/status', (req, res) => {
    const user = req.user!;
    if (!allowed(user)) {
      res.json({ available: false });
      return;
    }
    res.json({
      available: true,
      mode: generator.mode,
      model: generator.model ?? null,
      dailyLimit,
      usedToday: usedToday(db, user.id, now()),
      limits: { maxFiles: LIMITS.maxFiles, maxFileMB: Math.round(LIMITS.maxBinaryBytes / 1024 / 1024), maxImageMB: 5, maxTextChars: LIMITS.maxTextChars, maxFocusChars: LIMITS.maxFocusChars },
    });
  });

  router.post('/generate', (req, res, next) => {
    const user = req.user!;
    try {
      requireAccess(user);
    } catch (e) {
      next(e);
      return;
    }
    upload(req, res, async (uploadError) => {
      try {
        if (uploadError) {
          const code = (uploadError as { code?: string }).code;
          if (code === 'LIMIT_FILE_SIZE') throw new HttpError(413, `One of the files is bigger than ${Math.round(LIMITS.maxBinaryBytes / 1024 / 1024)} MB. Try a smaller file, or split it up.`);
          if (code === 'LIMIT_FILE_COUNT' || code === 'LIMIT_UNEXPECTED_FILE') throw new HttpError(400, `Please use ${LIMITS.maxFiles} files or fewer at a time.`);
          if (code === 'LIMIT_FIELD_VALUE') throw new HttpError(413, 'The pasted notes are too long.');
          throw uploadError;
        }
        const options = parse(optionsSchema, req.body ?? {});
        if (jobs.working(user.id)) throw new HttpError(409, "Georgie is still working on your last notes. Wait for it to finish, or cancel it first.");

        const files = (req.files as Express.Multer.File[] | undefined) ?? [];
        const parts = await readNotes(
          files.map((f) => ({ name: Buffer.from(f.originalname, 'latin1').toString('utf8'), buffer: f.buffer })),
          options.text,
        );
        if (!takeQuota(db, user.id, dailyLimit, now())) {
          throw new HttpError(429, `You've used all ${dailyLimit} of today's goes at turning notes into flashcards. It resets at midnight (UTC).`);
        }

        const job = jobs.create(user.id, now());
        res.status(202).json({ jobId: job.id });

        // The AI takes a minute or two, so it runs in the background and the screen checks on it.
        generator
          .generate({
            parts,
            options: { density: options.density, focus: options.focus || undefined },
            signal: job.abort.signal,
            onProgress: (p) => {
              job.stage = p.stage;
              if (p.cards !== undefined) job.cards = p.cards;
            },
          })
          .then((result) => {
            job.result = result;
            job.status = 'done';
            job.stage = 'Done';
            job.cards = result.topics.reduce((n, t) => n + t.cards.length, 0);
            job.finishedAt = now();
            if (result.usage) console.log(`Notes to flashcards: ${result.usage.inputTokens} input and ${result.usage.outputTokens} output tokens (${result.model}).`);
          })
          .catch((err) => {
            const problem = explainApiError(err, job.abort.signal);
            job.status = job.abort.signal.aborted ? 'cancelled' : 'error';
            job.error = problem.message;
            job.finishedAt = now();
            refundQuota(db, user.id, now()); // nothing was delivered, so the go isn't used up
          });
      } catch (e) {
        next(e);
      }
    });
  });

  router.get('/jobs/:id', (req, res) => {
    requireAccess(req.user!);
    const job = jobs.get(req.user!.id, String(req.params.id));
    if (!job) throw new HttpError(404, 'That job has expired. Please start again.');
    res.json({
      status: job.status,
      stage: job.stage,
      cards: job.cards,
      error: job.error,
      result: job.status === 'done' ? job.result : undefined,
    });
  });

  router.delete('/jobs/:id', (req, res) => {
    requireAccess(req.user!);
    const job = jobs.get(req.user!.id, String(req.params.id));
    if (job) {
      job.abort.abort();
      if (job.status !== 'working') jobs.remove(job.id);
    }
    res.json({ ok: true });
  });

  return router;
}

export { NotesError };
