# Georgie Flashcards

Flashcards organised into folders and subfolders (any depth), with images on cards,
per-user accounts, and Anki-style spaced repetition.

## Run it

Requires Node 22+.

```bash
npm install
npm run dev        # client on http://localhost:5173, API on :3001
```

Production: `npm run build && npm start` serves everything on http://localhost:3000
(set `PORT` to change it, and `SECURE_COOKIES=1` behind HTTPS).

Data lives in `data/` (`app.db` SQLite file and `uploads/` images). Set `DATA_DIR` to move it.
Back up that folder to back up everything.

```bash
npm test           # scheduler, 4am day boundary, queue, and API tests
npm run typecheck
```

## How it fits together

- `shared/` code used by both server and browser:
  - `scheduler.ts`: the pure `schedule(card, rating, now, config)` function
  - `srsConfig.ts`: every tunable number (learning steps, ease, multipliers, caps, new-card limit)
  - `time.ts`: the 4am "study day" in the user's timezone
- `server/`: Express + SQLite. `queue.ts` builds the study queue; `routes/study.ts` runs the scheduler and saves the result.
- `client/`: React. The study page uses the same `schedule()` only to preview the interval under each button.

## Scheduling

Ratings: Hard, Medium, Good, Easy (keys `1`-`4`). Click the card or press `Space` to flip it.
Learning steps are 1 and 10 minutes. On a learning card, Hard comes back in 1 minute and Medium in 5
(`mediumLearningDelay` in `shared/srsConfig.ts`). Review intervals grow by x1.2 / x ease / x ease x 1.3,
capped at 365 days, with +/-5% fuzz above 2 days. Fuzz is derived from the card id (not
`Math.random`) so previews always match what gets saved. A card comes back exactly as far ahead as its button says
(rate it at 3pm with a "4d" button and it is due in 4 days, at 3pm). The 4am "study day" is only used for the daily
new-card limit, which resets at 4am local time.

Every rating is appended to `review_log` (insert-only, enforced by database triggers).

Choices the spec left open:
- After a lapse, the post-lapse interval (half the old one, minimum 1 day) is kept in `interval_days`
  during relearning so the card knows where to graduate to.
- Easy during relearning graduates with that interval plus one day, so it still beats Good.
- Passwords are hashed with bcrypt; sessions are httpOnly cookies lasting 30 days.

When you've rated everything that is due and only cards you're still learning remain, the study page shows a
countdown ("Next card in 4:32") and the card appears by itself when its time is up. Nothing is shown early.

## Browsing without spaced repetition

Click any card in a folder (or a search result) to review it: it opens flip-through mode, starting at that card.
Space flips it, the arrow keys move between cards, and it covers the folder's subfolders too. Nothing is scheduled or
logged. The pencil on a card row edits it. **Study** is the spaced-repetition mode.

## Export and reset

- **Export CSV** (dashboard): downloads every card as `Folder,Front,Back`. The folder column holds the full path,
  e.g. `Biology / Cells`. Opens in Excel/Sheets and imports into Anki, Quizlet and similar apps. Images aren't included.
- **Reset progress** (folder menu, the `...` button): puts every card in that folder and its subfolders back to new.
  Cards are kept, and the review history is kept.
