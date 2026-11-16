# PARALLEL Interview Studio

Live coding interviews that feel like pairing. Interviewer and candidate share:
- a CodeMirror editor with live cursors and line comments
- a whiteboard
- interviewer "pins" on lines and tokens
- visible and hidden test cases that run in a remote sandbox

## Stack

| Layer | Choice |
| --- | --- |
| App | Next.js 15 (App Router), React 19, TypeScript, CodeMirror 6 |
| Data / auth / realtime | Supabase: Postgres with RLS, Auth (email + anonymous), private Realtime channels |
| Code execution | Wandbox (default), or a self-hosted Piston via `PISTON_URL` |

Every database object is prefixed `pl_`, because the Supabase project is shared with other apps.

## Setup

1. Install:
   ```bash
   npm install
   ```
2. Copy `.env.example` to `.env.local`, then fill in `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY`.
3. Apply the schema. Run the two files in `supabase/migrations/` in order, in the Supabase SQL editor or with `psql "$DATABASE_URL" -f <file>`:
   - `0001_init.sql` creates the tables, RLS policies, functions and realtime rules.
   - `0002_hints_assign.sql` moves hints behind server functions and makes problem assignment atomic.

   The question bank lives only in the database, because its rows hold hidden tests and hints. A new project starts with an empty bank, and you can still write a problem for each interview on the setup page.
   To fill the bank, insert rows into `pl_problems` from the SQL editor. A null `owner_id` makes a problem available to every interviewer. If you keep that SQL in a file, name it `supabase/seed.sql`: git ignores it.
4. In the Supabase dashboard → Authentication, **enable anonymous sign-ins**. Candidates join anonymously with the room key.
5. Run `npm run dev` and open http://localhost:3000.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server (Turbopack) |
| `npm run build` / `npm start` | Production build / serve |
| `npm run lint` | ESLint |
| `npm run test:keys` | Connect-key entropy and normalisation checks (offline) |
| `npm run test:sandbox` | Sandbox isolation and grading checks. Sends test programs to Wandbox, no database access. |
| `node scripts/e2e.mjs`, `node scripts/e2e2.mjs` | HTTP end-to-end tests against the real API, live DB and sandbox. They need the dev server running and the `TEST_*` accounts from `.env.example`. Each **creates one session in the database** and deletes it at the end. |

## Layout

```
src/app/                  / (sign in), /dashboard, /setup, /join, /studio/[id]
src/app/api/              join, sessions (create), sessions/[id]/{assign,end}, run
src/components/studio/    Studio shell, HeaderBar, LeftPanel (problem/rubric/bank/notes),
                          CodePanel + Editor, TestDock, Whiteboard, StatusBar,
                          useStudio (state + realtime)
src/lib/                  Supabase clients, sandbox, rate limiting, keys, validation, theme, types
```

## How an interview runs

1. The interviewer signs in, goes to **New interview**, and picks or writes a problem, visible and hidden tests, and optional co-interviewer emails. **Create & launch** creates the room.
2. The candidate opens `/join` and enters the connect key. They get the single candidate seat.
3. A co-interviewer signs in with an invited email and uses the same key. They get an interviewer seat.
4. Both edit the shared buffer, sketch on the whiteboard, and comment on lines. The interviewer can pin lines or tokens in Highlight mode.
5. **Run** executes against every test case. The candidate sees visible results and a hidden pass count. Interviewers see every case.
6. The interviewer scores the rubric, keeps private notes, and clicks **End**. That locks the room for everyone.

## Known limitations

- Editing is last-write-wins on the whole buffer. If two people type at the same moment, one edit can replace the other.
- The candidate seat belongs to the browser session that first joined. A candidate who clears cookies or switches browser gets "seat taken" and can't rejoin.
- The whiteboard uses pixel positions, so people with different window heights see a different slice of the board.

See [SECURITY.md](SECURITY.md) for the trust model and known gaps.
