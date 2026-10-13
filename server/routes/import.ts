import express, { Router } from 'express';
import { z } from 'zod';
import type { DB } from '../db';
import { parse } from '../http';
import { optionsSchema } from '../importSchemas';
import { apkgRouter } from './importApkg';
import { commitImport, dryRunImport, MAX_IMPORT_CARDS, type ImportItem } from '../importer';
import { MAX_FIELD_LENGTH, MAX_FOLDER_DEPTH, MAX_NAME_LENGTH } from '../../shared/importParse';

const textImportSchema = optionsSchema.extend({
  cards: z
    .array(
      z.object({
        path: z.array(z.string().max(MAX_NAME_LENGTH)).max(MAX_FOLDER_DEPTH),
        front: z.string().max(MAX_FIELD_LENGTH),
        back: z.string().max(MAX_FIELD_LENGTH),
      }),
    )
    .max(MAX_IMPORT_CARDS),
});

/** Importing from text/CSV files, which the browser has already read and cleaned up. */
export function importRouter(db: DB, uploadsDir: string, stagingDir: string) {
  const router = Router();
  // A big file is a big request: allow far more than the 1 MB the rest of the API accepts.
  router.use(express.json({ limit: '25mb' }));

  router.use('/apkg', apkgRouter(db, { uploadsDir, stagingDir }));

  router.post('/dry-run', (req, res) => {
    const body = parse(textImportSchema, req.body);
    res.json(dryRunImport(db, req.user!.id, body.cards as ImportItem[], body));
  });

  router.post('/', (req, res) => {
    const body = parse(textImportSchema, req.body);
    res.status(201).json(commitImport(db, req.user!, body.cards as ImportItem[], { ...body, uploadsDir }));
  });

  return router;
}
