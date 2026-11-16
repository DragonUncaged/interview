# Security

## Trust model

Postgres is the source of authority. The browser holds a user JWT and can query Supabase directly, so every guarantee below is enforced by RLS, by SECURITY DEFINER functions, or by the server. The UI is never trusted to enforce anything.

- **Roles.** `pl_join_session(key, name)` is the only way into `pl_session_participants`, and clients have no INSERT policy on that table. The function derives the role:
  - the creator becomes interviewer
  - a confirmed, non-anonymous email on `pl_session_invites` becomes interviewer
  - anyone else gets the single candidate seat

  The client never sends a role.
- **Membership checks.** `pl_is_participant()` and `pl_is_interviewer()` back every other policy.
- **Hidden tests.**
  - `pl_test_cases` hidden rows are readable only by interviewers.
  - `pl_problems.hidden_tests` is column-revoked from `anon`/`authenticated`.
  - Routes read them with the service role.
- **Run results.**
  - Only the service role writes `pl_runs`.
  - Hidden-case details go to `pl_run_hidden_results`, which only interviewers can read.
  - `/api/run` returns hidden details only to interviewers.
- **Hints.** `pl_sessions.hints` is column-revoked from clients, so clients must select explicit columns, listed in `SESSION_COLUMNS` in `src/lib/types.ts`.
  - `pl_session_hints()` returns every hint to interviewers, and to candidates only the ones they have revealed.
  - `pl_reveal_hint()` is the only way to reveal one. It checks the caller is the candidate, enforces the order, and records the reveal before returning the text.
- **Problem assignment.** `pl_assign_problem()` checks the caller is an interviewer and that the problem is a builtin or their own. It then swaps the problem, test cases and hint reveals in one transaction.
- **Private data.**
  - Rubric scores and interviewer notes are interviewer-only.
  - Candidate notes are author-only.
- **Realtime.** Channels are private, named `pl:session:<id>`, and policies on `realtime.messages` authorize them. Any participant can still send any payload, so the client treats comment, highlight, run and session broadcasts as *signals to re-read the row*, never as data.
- **Comment identity.** `pl_comments.author_name`/`author_role` are client-written. The UI shows the identity from `pl_session_participants` instead.
- **Connect keys.** Keys are `PXR-` plus 6 symbols from a 31-char alphabet, about 887M combinations, generated with rejection sampling. Create and join both enforce the exact shape. See `src/lib/keys.ts`, and `npm run test:keys` for the checks.

## Code execution (`src/lib/sandbox.ts`)

- Candidate code runs on Wandbox or Piston, never on our server.
- Only test **inputs** enter the sandbox. Expected outputs stay in Node, where the comparison happens.
- Visible and hidden cases run in **separate** sandbox processes, so a visible case's output can't carry hidden data.
- The harness tags its results line with a per-run random sentinel, and the server reads the **last** such line. Candidate output can't forge a verdict.
- Only the visible run's error reaches the candidate. A hidden run's stack trace could quote a hidden input.
- `npm run test:sandbox` checks these guarantees against the live sandbox provider, including exfiltration and verdict-forgery attempts.
- Limits:
  - code: 64,000 chars
  - test input and expected output: 10,000 chars each
  - tests: 12 visible + 12 hidden

## Rate limits (`src/lib/ratelimit.ts`)

| Route | Limit | Key |
| --- | --- | --- |
| `POST /api/join` | 10 / 60s | client IP |
| `POST /api/sessions` | 20 / 60s | client IP |
| `POST /api/sessions/[id]/assign` | 20 / 60s and 1 / 2s | client IP; session (after auth) |
| `POST /api/sessions/[id]/end` | 20 / 60s | client IP |
| `POST /api/run` | 1 / 2s and 10 / 60s | session; user |

- **Storage.** Counts are kept in memory unless `UPSTASH_REDIS_REST_URL`/`TOKEN` are set. On serverless that means each instance counts on its own, and the effective limit is max × instances. If Redis is unreachable, the limiter fails open to the in-memory window.
- **Client IP.** Taken from `x-real-ip`, else the last `x-forwarded-for` entry. With no proxy in front, as with a bare `next start`, every client shares the `unknown` bucket.

## Other controls

- Ids from clients are checked as uuids before reaching Postgres. Postgres errors are logged, never returned to the client.
- `next.config.ts` sends `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `nosniff`, `strict-origin-when-cross-origin`, a deny-all Permissions-Policy and HSTS on every route. There is no script-src CSP, because Next hydration and CodeMirror styles would need nonces.
- The comment thread widget builds DOM outside React. Every user string, including derived initials, goes through `escapeHtml`.

## Known open issues

1. **Anonymous sign-ins must be enabled** in the dashboard, or candidates can't join.
2. **Builtin problems are visible to any signed-in, non-anonymous account**, hints included. A candidate who joins with a real account could look up a builtin problem's hints in `pl_problems`. Candidates who join anonymously, the normal path, can't.

## Verifying the database

Run these in the Supabase SQL editor.

```sql
-- RLS must be on for every pl_ table
select tablename, rowsecurity from pg_tables
where schemaname = 'public' and tablename like 'pl\_%' order by 1;

-- Review the policies
select tablename, policyname, cmd, qual, with_check from pg_policies
where schemaname = 'public' and tablename like 'pl\_%' order by 1, 2;

-- hidden_tests must not be selectable by clients. Expect no anon or authenticated rows.
select grantee, privilege_type from information_schema.column_privileges
where table_name = 'pl_problems' and column_name = 'hidden_tests';

-- hints must not be selectable by clients. Expect no rows.
select grantee from information_schema.column_privileges
where table_name = 'pl_sessions' and column_name = 'hints' and grantee in ('anon', 'authenticated');

-- Realtime authorization must exist
select policyname, cmd from pg_policies where schemaname = 'realtime' and tablename = 'messages';
```

## Deployment checklist

- `SUPABASE_SERVICE_ROLE_KEY` is set only as a server env var, never `NEXT_PUBLIC_`.
- Set the Upstash env vars on any multi-instance or serverless deploy.
- The proxy sets `x-real-ip`. Vercel does.
- Anonymous sign-ins are enabled; interviewer email confirmation is enabled.
- For production, point `PISTON_URL` at a self-hosted Piston instead of the public Wandbox.
