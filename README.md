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
