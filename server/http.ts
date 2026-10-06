import type { ErrorRequestHandler } from 'express';
import { z } from 'zod';

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data);
  if (!result.success) {
    const issue = result.error.issues[0];
    const where = issue.path.length ? `${issue.path.join('.')}: ` : '';
    throw new HttpError(400, `${where}${issue.message}`);
  }
  return result.data;
}

export const idParam = z.coerce.number().int().positive();

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  if (err?.name === 'MulterError') {
    const message = err.code === 'LIMIT_FILE_SIZE' ? 'Images must be 10 MB or smaller' : err.message;
    res.status(400).json({ error: message });
    return;
  }
  console.error(err);
  res.status(500).json({ error: 'Something went wrong' });
};
