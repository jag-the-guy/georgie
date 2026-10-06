import { Router } from 'express';
import type { DB } from '../db';

const csvCell = (value: string) => (/[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);

/** One CSV of all the user's cards: Folder, Front, Back. Opens in Excel/Sheets and imports into Anki, Quizlet, etc. */
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

    const cards = db
      .prepare('SELECT folder_id, front, back FROM cards WHERE user_id = ? ORDER BY created_at, id')
      .all(user.id) as { folder_id: number; front: string; back: string }[];
    const rows = cards
      .map((c) => ({ folder: pathOf(c.folder_id), front: c.front, back: c.back }))
      .sort((a, b) => a.folder.localeCompare(b.folder)); // stable, so cards keep their creation order within a folder

    const lines = ['Folder,Front,Back', ...rows.map((r) => [r.folder, r.front, r.back].map(csvCell).join(','))];
    const date = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="georgie-flashcards-${date}.csv"`);
    // BOM so Excel reads accents and non-Latin text correctly.
    res.send('﻿' + lines.join('\r\n') + '\r\n');
  });

  return router;
}
