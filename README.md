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

- **Export CSV** (dashboard, or **Export to CSV...** in a folder's `...` menu): opens a list of your folders with
  checkboxes. Tick the ones to include (ticking a folder ticks the folders inside it; you can untick any), and it
  downloads `Folder,Front,Back`. The folder column holds the full path, e.g. `Biology / Cells`. Opens in
  Excel/Sheets and imports into Anki, Quizlet and similar apps. Images aren't included. Georgie's own **Import** reads
  these files back in.
- **Reset progress** (folder menu, the `...` button): puts every card in that folder and its subfolders back to new.
  Cards are kept, and the review history is kept.

## Turn your notes into flashcards (AI)

**Notes to cards** on the dashboard takes your notes and has Claude (Anthropic's AI) read them, work out the subject
and topics, and write flashcards. You then **review every card** (edit, untick, delete, add your own, rename topics),
choose where they go (a new folder, or inside one you already have; each topic can become a subfolder), and import.

- **Inputs:** PDF (including scanned pages), Word `.docx`, `.txt`/`.md`, photos or screenshots of notes (PNG, JPEG,
  GIF, WebP), and pasted text. Up to 6 files, 20 MB of PDFs/pictures in total. Pictures: 5 MB each. iPhone HEIC
  photos, RTF, PowerPoint and Excel aren't supported (save as PDF).
- **How many cards:** Light / Standard / Thorough, plus an optional "focus on..." note.
- **Privacy:** the notes are sent to Anthropic to make the cards. Georgie doesn't store them: they're held in memory
  only while the job runs. Only the cards you import are saved.
- **Who can use it:** it costs money, so on the live site it's **off unless `NOTES_AI_USERS` lists your email**
  (comma-separated). On your own computer everyone can use it. Each person is also capped per day (`NOTES_AI_DAILY_LIMIT`,
  default 20); a go that fails or is cancelled is given back.
- **Settings** go in `.env` (git-ignored; copy `.env.example`), or Railway's Variables tab:
  `ANTHROPIC_API_KEY` (get one at https://console.anthropic.com, pay-per-use), `NOTES_AI_USERS`, and optionally
  `NOTES_AI_MODEL` (default `claude-opus-5-5`; `claude-sonnet-5-5` costs about half as much) and `NOTES_AI_DAILY_LIMIT`.
- **Demo mode:** with no key, a simple rule-based demo makes sample cards from plain text ("Term: definition" lines),
  clearly labelled as not real AI, so you can try every screen. It can't read PDFs or pictures.
- **Check your key works:** `npx tsx scripts/check-ai.ts` makes one small real request (a few cents) and prints the result.
- **Rough cost** (Claude Opus 5.5 at $4 / $20 per million tokens, thinking included): a 20-page document is typically
  tens of cents; a 100-page PDF a couple of dollars. Sonnet 5.5 is about half. Look at your usage on the Anthropic console.
- Requests also opt in to Anthropic's server-side refusal fallback. If the AI declines a set of notes anyway (it can
  be over-cautious with some biology/chemistry content), the screen says so and the go is given back.
- Code: `server/notes/` (reading files, the prompt, the Claude call, the demo), `server/routes/notes.ts`,
  `client/pages/Notes.tsx`.

## Type your answer

On the study screen, the **Type my answer** switch (remembered on that device) asks you to type what you think the
answer is before the card flips. Georgie compares it with the back of the card and shows **Correct**, **Almost** or
**Not quite**, a friendly message (wrong answers get a shuffled encouraging one, never the same twice in a row), and what
you typed. It suggests a rating (Good, Medium or Hard) by highlighting a button, but you always choose; nothing is
rated for you.

The check is forgiving: capitals, punctuation and extra spaces don't matter; small typos are forgiven in longer words
(not in short words or numbers, so "1968" is wrong for "1969"); word order and little words ("the", "to", "el") are
flexible; a missing accent counts as right with a "Watch the accent" note; notes in (brackets), the first line, and
alternatives separated by `;`, `/` or `|` can stand alone. Cards with no text on the back, and fill-in-the-blank
cards, skip typing and flip as usual. The matching logic is `shared/answerMatch.ts`.

## Importing cards from other apps

**Import** (dashboard, next to Export CSV) reads a file, works out the layout, and shows three example cards as they
would look in Georgie before anything is saved. You can swap front and back, change the separator or header row, pick
the destination folder, and see how many duplicates would be skipped.

- **Text / CSV / TSV** (`.csv .tsv .txt`): Georgie's own export, Anki "Notes in Plain Text", Quizlet exports, and
  spreadsheets saved as CSV. It detects the separator, a header row, which column is the front/back, and a folder or
  deck column. HTML in the text is converted to plain text; fill-in-the-blank (cloze) cards become a question with
  blanks and an answer. Text files cannot contain pictures. Excel `.xlsx` files must be saved as CSV first.
- **Anki decks** (`.apkg`, `.colpkg`): both Anki's older format and the newer compressed one. Pictures come across on
  the correct side of each card; deck names become folders. Sounds/videos and SVG pictures are left out. Anki cards that
  have a reverse side are imported once. Limit: 50 MB per file.
- All imported cards start as new. Limit: 20,000 cards per import. Imports are all-or-nothing: if anything fails, nothing is added.
- Uploaded Anki decks wait in `staging/` (inside the data folder) for up to 30 minutes until you confirm, at most three per person.

## Design

The look is "night glass": frosted translucent panels with a hairline light edge over a soft blue glow, electric-blue accents with a glow, Space Grotesk numerals and Inter body text. Dark is the default; Light is a frosted daylight version.

Every colour is a design token (CSS variable such as `--color-bg`, `--color-primary`, `--rate-1-fg`). `client/styles.css` holds the base values, `client/themes/premium.css` gives each token its light and dark value (plus the `--fx-*` glass, gradient and glow tokens), and `client/themes/motion.css` adds the interaction layer: springy hovers and entrances, and a gold "Done for today" celebration. Motion is switched off for people whose system asks for reduced motion, and hover pops only run on devices with a real hover.

The sun / monitor / moon control (sidebar bottom, and the corner of the login page) picks Light, System or Dark. "System" follows the device live; the choice is remembered, and an inline script in `client/index.html` applies it before the first paint so nothing flashes.

`npm test` includes `tests/theme.test.ts`: Light and Dark must define the same tokens, no raw colours may creep into components, and every text/background pair must meet WCAG AA in both modes.

The earlier looks (the original lavender design and a lighter "New" design) are kept in git history: the `original-design` and `before-redesign` tags.

## Keeping your users' data safe (hosting on Railway)

Users' accounts, cards and images live in one folder (`DATA_DIR`), **not** in GitHub. Deploying new code replaces
the program and leaves that folder alone, as long as the folder is on a Railway **Volume**.

**One-time setup**
1. Add a **Volume** to the service, mount path `/data`. (If you forget, the app refuses to start and says so in the
   logs, rather than quietly saving data that would be wiped on the next deploy.)
2. Variables: `SECURE_COOKIES=1`, and `ADMIN_KEY` = a long random secret (24+ characters, e.g. run `openssl rand -hex 24`).
   `DATA_DIR` is optional: the app uses the Volume automatically.
3. Optional: Settings > Healthcheck path = `/healthz`.
4. Never click **Wipe Volume** in Railway, and never delete the Volume.

**After every deploy, look at the logs.** The first lines say how much data was loaded, for example
`Loaded 12 accounts, 40 folders, 900 cards, 31 images`. If that ever says 0 accounts after you had users, stop and
restore a backup (below) instead of letting people sign up again.

**What protects the data**
- Safe upgrades: when the database structure changes, the change is a *migration* (`server/db.ts`). It runs once,
  all-or-nothing, after a full copy is saved to `backups/pre-migration-...db`. A failed upgrade changes nothing.
  Never edit `schema.sql` to change an existing table; add a migration instead.
- Daily snapshots: `backups/app-YYYY-MM-DD.db`, refreshed every 6 hours, the newest 14 days kept.
  These sit on the same Volume, so they protect against bad deploys, bugs and accidental deletes only.
- **Off-site copy (do this regularly, e.g. weekly):** a full backup, database plus images, from your live site:
  `ADMIN_KEY='your-key' ./scripts/download-backup.sh https://your-site.up.railway.app`
  It saves a `.tar.gz` to `~/georgie-backups`. Keep copies somewhere other than Railway (another drive, Google Drive).
  Railway also offers volume backups on some plans (look for **Backups** on the Volume); worth turning on, but not a
  replacement for your own copy.

**Restoring** (from a downloaded `.tar.gz`, or a snapshot from `backups/`)
1. Stop the service in Railway so nobody is writing to the data while you restore.
2. Replace `app.db` in the Volume with the backup's `app.db` (delete `app.db-wal` and `app.db-shm` next to it),
   and copy the backup's `uploads/` folder into the Volume.
3. Start the service and check the logs show the expected counts.

**Rolling back a bad deploy** is safe for data: in Railway, redeploy the previous deployment. Data is not part of a
deployment. If you hit "permission denied" writing to the Volume, set `RAILWAY_RUN_UID=0` in Variables.
