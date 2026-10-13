import { Router } from 'express';
import { z } from 'zod';
import type { DB } from '../db';
import { parse } from '../http';

const csvCell = (value: string) => (/[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);

// ?folders=3,7,12 limits the export to those folders (just their own cards; subfolders only if listed too).
const foldersParam = z
  .string()
  .max(30_000)
  .regex(/^\d+(,\d+)*$/, 'Choose at least one folder to export')
  .transform((s) => s.split(',').map(Number));

/** A CSV of the user's cards (all, or the chosen folders): Folder, Front, Back. Opens in Excel/Sheets and imports into Anki, Quizlet, etc. */
export function exportRouter(db: DB) {
  const router = Router();

  router.get('/export.csv', (req, res) => {
    const user = req.user!;
    const folders = db.prepare('SELECT id, parent_id, name FROM folders WHERE user_id = ?').all(user.id) as {
      id: number;
      parent_id: number | null;
      name: string;
    }[];
    const byId = new Map(folders.map((f) => [f.id, f]));
    const pathOf = (id: number): string => {
      const names: string[] = [];
      for (let f = byId.get(id); f; f = f.parent_id ? byId.get(f.parent_id) : undefined) names.unshift(f.name);
      return names.join(' / ');
    };

    const chosen = req.query.folders === undefined ? null : parse(foldersParam, req.query.folders);
    // Only the user's own cards are ever selected, so ids belonging to someone else simply match nothing.
    const cards = (
      chosen === null
        ? db.prepare('SELECT folder_id, front, back FROM cards WHERE user_id = ? ORDER BY created_at, id').all(user.id)
        : db
            .prepare('SELECT folder_id, front, back FROM cards WHERE user_id = ? AND folder_id IN (SELECT value FROM json_each(?)) ORDER BY created_at, id')
            .all(user.id, JSON.stringify(chosen))
    ) as { folder_id: number; front: string; back: string }[];
    const rows = cards
      .map((c) => ({ folder: pathOf(c.folder_id), front: c.front, back: c.back }))
      .sort((a, b) => a.folder.localeCompare(b.folder)); // stable, so cards keep their creation order within a folder

    const lines = ['Folder,Front,Back', ...rows.map((r) => [r.folder, r.front, r.back].map(csvCell).join(','))];
    const date = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="georgie-flashcards${chosen ? '-selected' : ''}-${date}.csv"`);
    // BOM so Excel reads accents and non-Latin text correctly.
    res.send('﻿' + lines.join('\r\n') + '\r\n');
  });

  return router;
}
