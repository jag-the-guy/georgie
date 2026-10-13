import { z } from 'zod';
import { MAX_NAME_LENGTH } from '../shared/importParse';

/** Where to put imported cards, and how, as sent by the browser (shared by text and Anki imports). */
export const optionsSchema = z.object({
  destination: z.discriminatedUnion('type', [
    z.object({ type: z.literal('new'), name: z.string().max(MAX_NAME_LENGTH * 2), parentId: z.number().int().positive().nullable().optional() }),
    z.object({ type: z.literal('existing'), folderId: z.number().int().positive() }),
  ]),
  rebuildFolders: z.boolean(),
  skipDuplicates: z.boolean(),
});
