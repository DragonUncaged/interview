/**
 * End-to-end test that drives the REAL Next.js API routes over HTTP with REAL
 * Supabase auth cookies (built by @supabase/ssr, exactly like the browser),
 * against the live database + sandbox. Focus: the interviewer/candidate
 * boundary and hidden-test isolation.
 *
 * Run with the dev server up on APP:  node scripts/e2e.mjs
 */
import { createServerClient } from '@supabase/ssr';
import { readFileSync } from 'node:fs';

// load .env.local
for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
}

const APP = process.env.APP_URL || 'http://localhost:3000';
const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// Two confirmed accounts, set in .env.local. See .env.example.
const INTERVIEWER = { email: process.env.TEST_INTERVIEWER_EMAIL, password: process.env.TEST_INTERVIEWER_PASSWORD };
const SECOND = { email: process.env.TEST_SECOND_EMAIL, password: process.env.TEST_SECOND_PASSWORD };
if (!INTERVIEWER.email || !INTERVIEWER.password || !SECOND.email || !SECOND.password) {
  console.error('Set TEST_INTERVIEWER_EMAIL/PASSWORD and TEST_SECOND_EMAIL/PASSWORD in .env.local.');
  process.exit(1);
}

let pass = 0,
  fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`${cond ? '  ✅' : '  ❌'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (cond) pass++;
  else fail++;
};

/** A cookie jar + a Supabase client that writes auth into it, like the browser. */
function makeSession() {
  const jar = new Map();
  const client = createServerClient(SUPA_URL, ANON, {
    cookies: {
      getAll: () => [...jar.entries()].map(([name, value]) => ({ name, value })),
      setAll: (cs) => cs.forEach(({ name, value }) => (value ? jar.set(name, value) : jar.delete(name))),
    },
  });
  const cookieHeader = () =>
    [...jar.entries()].map(([n, v]) => `${n}=${encodeURIComponent(v)}`).join('; ');
  return { client, cookieHeader };
}

const api = (path, cookie, body) =>
  fetch(`${APP}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify(body ?? {}),
  });

async function main() {
  console.log(`\n▶ E2E against ${APP}\n`);

  // ---- sign in both personas (real JWTs, cookies land in jars) ----
  const alex = makeSession();
  const priya = makeSession();
  const visitor = makeSession(); // never signs in
  {
    const a = await alex.client.auth.signInWithPassword(INTERVIEWER);
    const p = await priya.client.auth.signInWithPassword(SECOND);
    console.log('§ Auth');
    ok('interviewer signs in', !a.error && !!a.data.session, a.error?.message);
    ok('candidate signs in', !p.error && !!p.data.session, p.error?.message);
  }

  // ---- interviewer creates a session ----
  console.log('\n§ Session creation (/api/sessions)');
  const createRes = await api('/api/sessions', alex.cookieHeader(), {
    candidateName: 'Priya Nair',
    candidateRoleLabel: 'Senior Backend · R2',
    problemNumber: 1,
    problemTitle: 'Two Sum',
    difficulty: 'easy',
    description: 'Return indices of the two numbers adding to target.',
    hints: ['Think about a hash map.', 'Store each value -> index as you go.'],
    starterCode: {
      python: 'from typing import List\n\nclass Solution:\n    def twoSum(self, nums: List[int], target: int) -> List[int]:\n        pass\n',
    },
    visibleTests: [
      { input: 'nums=[2,7,11,15], target=9', expected: '[0,1]' },
      { input: 'nums=[3,2,4], target=6', expected: '[1,2]' },
    ],
    hiddenTests: [
      { input: 'nums=[3,3], target=6', expected: '[0,1]' },
      { input: 'nums=[-1,-8,3,90], target=-9', expected: '[0,1]' },
    ],
    inviteEmails: [],
  });
  const created = await createRes.json();
  ok('interviewer creates session', createRes.ok && !!created.sessionId, created.error);
  const sessionId = created.sessionId;
  const roomKey = created.roomKey;
  console.log(`    session ${sessionId}  key ${roomKey}`);

  // ---- candidate cannot create a session for someone else's demo (anon block already covered);
  //      here test that an outsider account creating is allowed but isolated ----

  // ---- candidate joins by key ----
  console.log('\n§ Join (/api/join) — role assignment');
  const joinRes = await api('/api/join', priya.cookieHeader(), { key: roomKey, name: 'Priya Nair' });
  const joined = await joinRes.json();
  ok('candidate joins with key', joinRes.ok, joined.error);
  ok('candidate is assigned CANDIDATE role (not interviewer)', joined.role === 'candidate', `got ${joined.role}`);

  // A key outside the alphabet (O is excluded) never reaches the database...
  const malformedJoin = await api('/api/join', priya.cookieHeader(), { key: 'PXR-NOPE99' });
  ok('malformed key rejected before the RPC', malformedJoin.status === 400, `status ${malformedJoin.status}`);
  // ...while a well-formed key for no room is rejected by pl_join_session.
  const unknownJoin = await api('/api/join', priya.cookieHeader(), { key: 'PXR-ZZZZZZ' });
  ok('unknown key rejected', unknownJoin.status === 403, `status ${unknownJoin.status}`);

  // ---- RLS: candidate reading the DB directly with their own token ----
  console.log('\n§ Direct DB reads under candidate RLS');
  const { data: cTests } = await priya.client
    .from('pl_test_cases')
    .select('id,hidden')
    .eq('session_id', sessionId);
  ok('candidate sees only VISIBLE test cases', (cTests ?? []).length === 2 && (cTests ?? []).every((t) => !t.hidden), `rows=${(cTests ?? []).length}`);
  const { data: hc } = await priya.client.rpc('pl_hidden_test_count', { p_session_id: sessionId });
  ok('candidate can read hidden COUNT only', hc === 2, `count=${hc}`);
  const { data: cRubric } = await priya.client.from('pl_rubric_scores').select('*').eq('session_id', sessionId);
  ok('candidate cannot read rubric', (cRubric ?? []).length === 0);

  // ---- hints: column revoked, ladder enforced in pl_reveal_hint ----
  console.log('\n§ Hints (server-enforced ladder)');
  const { error: hintColErr } = await priya.client.from('pl_sessions').select('hints').eq('id', sessionId);
  ok('candidate cannot select pl_sessions.hints', !!hintColErr, hintColErr?.message);
  const { error: starErr } = await priya.client.from('pl_sessions').select('*').eq('id', sessionId);
  ok("select('*') on pl_sessions is denied", !!starErr, starErr?.message);
  const { data: h0 } = await priya.client.rpc('pl_session_hints', { p_session_id: sessionId });
  ok('candidate sees hint count but no text before revealing', h0?.length === 2 && h0.every((h) => h.text === null && !h.revealed), JSON.stringify(h0));
  const { error: skipErr } = await priya.client.rpc('pl_reveal_hint', { p_session_id: sessionId, p_index: 1 });
  ok('candidate cannot skip ahead to hint 2', !!skipErr && skipErr.message.includes('hint_locked'), skipErr?.message);
  const { error: directErr } = await priya.client
    .from('pl_hint_reveals')
    .insert({ session_id: sessionId, hint_index: 1, revealed_by: (await priya.client.auth.getUser()).data.user.id });
  ok('candidate cannot insert a reveal directly', !!directErr, directErr?.message);
  const { data: t0, error: revErr } = await priya.client.rpc('pl_reveal_hint', { p_session_id: sessionId, p_index: 0 });
  ok('candidate reveals hint 1', !revErr && t0 === 'Think about a hash map.', revErr?.message ?? t0);
  const { data: h1 } = await priya.client.rpc('pl_session_hints', { p_session_id: sessionId });
  ok('only the revealed hint has text', h1?.[0]?.text === 'Think about a hash map.' && h1?.[1]?.text === null, JSON.stringify(h1));
  const { data: hi } = await alex.client.rpc('pl_session_hints', { p_session_id: sessionId });
  ok('interviewer sees every hint and the reveal', hi?.every((h) => h.text) && hi?.[0]?.revealed && !hi?.[1]?.revealed, JSON.stringify(hi));
  const { error: intRevErr } = await alex.client.rpc('pl_reveal_hint', { p_session_id: sessionId, p_index: 1 });
  ok('interviewer cannot reveal on the candidate’s behalf', !!intRevErr, intRevErr?.message);

  // interviewer sees all
  const { data: iTests } = await alex.client.from('pl_test_cases').select('id,hidden').eq('session_id', sessionId);
  ok('interviewer sees ALL test cases (visible + hidden)', (iTests ?? []).length === 4, `rows=${(iTests ?? []).length}`);

  // outsider sees nothing
  const { data: oTests } = await visitor.client.from('pl_test_cases').select('id').eq('session_id', sessionId);
  ok('signed-out visitor sees no test cases', (oTests ?? []).length === 0);

  // ---- run code: THE hidden-isolation test on the real /api/run route ----
  console.log('\n§ Run code (/api/run) — hidden result isolation');
  const solution = `from typing import List

class Solution:
    def twoSum(self, nums: List[int], target: int) -> List[int]:
        seen = {}
        for i, n in enumerate(nums):
            if target - n in seen:
                return [seen[target - n], i]
            seen[n] = i
        return []
`;
  const candRun = await api('/api/run', priya.cookieHeader(), { sessionId, language: 'python', code: solution });
  const candRunJson = await candRun.json();
  ok('candidate can trigger a run', candRun.ok, candRunJson.error);
  ok('candidate run response has summary', !!candRunJson.summary);
  ok('candidate response OMITS hiddenResults', candRunJson.hiddenResults === undefined, JSON.stringify(candRunJson.hiddenResults));
  ok('candidate summary shows visible passed 2/2', candRunJson.summary?.passed === 2 && candRunJson.summary?.total === 2, JSON.stringify(candRunJson.summary));
  ok('candidate sees hidden COUNT but not detail', candRunJson.summary?.hiddenTotal === 2 && candRunJson.summary?.hiddenPassed === 2, JSON.stringify(candRunJson.summary));

  await new Promise((r) => setTimeout(r, 2500)); // clear per-session run cooldown

  const intRun = await api('/api/run', alex.cookieHeader(), { sessionId, language: 'python', code: solution });
  const intRunJson = await intRun.json();
  ok('interviewer can trigger a run', intRun.ok, intRunJson.error);
  ok('interviewer response INCLUDES hiddenResults', Array.isArray(intRunJson.hiddenResults) && intRunJson.hiddenResults.length === 2, JSON.stringify(intRunJson.hiddenResults?.length));
  ok('interviewer hidden cases pass', (intRunJson.hiddenResults ?? []).every((r) => r.pass));

  // candidate cannot read hidden run details table even directly
  const { data: cHidden } = await priya.client.from('pl_run_hidden_results').select('*').eq('session_id', sessionId);
  ok('candidate cannot read pl_run_hidden_results', (cHidden ?? []).length === 0);
  const { data: iHidden } = await alex.client.from('pl_run_hidden_results').select('run_id').eq('session_id', sessionId);
  ok('interviewer CAN read pl_run_hidden_results', (iHidden ?? []).length >= 1, `rows=${(iHidden ?? []).length}`);

  // ---- candidate cannot end the session; interviewer can ----
  console.log('\n§ Session control');
  const candEnd = await api(`/api/sessions/${sessionId}/end`, priya.cookieHeader(), {});
  ok('candidate CANNOT end session', candEnd.status === 403, `status ${candEnd.status}`);
  const intEnd = await api(`/api/sessions/${sessionId}/end`, alex.cookieHeader(), {});
  ok('interviewer CAN end session', intEnd.ok, `status ${intEnd.status}`);

  // ---- candidate private notes hidden from interviewer ----
  console.log('\n§ Private notes');
  await priya.client.from('pl_candidate_notes').upsert(
    { session_id: sessionId, user_id: (await priya.client.auth.getUser()).data.user.id, body: 'secret' },
    { onConflict: 'session_id,user_id' }
  );
  const { data: iSeesNotes } = await alex.client.from('pl_candidate_notes').select('*').eq('session_id', sessionId);
  ok('interviewer cannot read candidate scratch notes', (iSeesNotes ?? []).length === 0);

  // ---- cleanup: delete the demo session (creator can) ----
  await alex.client.from('pl_sessions').delete().eq('id', sessionId);

  console.log(`\n${fail === 0 ? '✅ ALL PASSED' : '❌ FAILURES'} — ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
