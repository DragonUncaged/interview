/** Part 2: multi-interviewer invites + assign-from-bank, over the real routes. */
import { createServerClient } from '@supabase/ssr';
import { readFileSync } from 'node:fs';

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

let pass = 0, fail = 0;
const ok = (n, c, d = '') => { console.log(`${c ? '  ✅' : '  ❌'} ${n}${d ? ` — ${d}` : ''}`); if (c) pass++; else fail++; };

function makeSession() {
  const jar = new Map();
  const client = createServerClient(SUPA_URL, ANON, {
    cookies: {
      getAll: () => [...jar.entries()].map(([name, value]) => ({ name, value })),
      setAll: (cs) => cs.forEach(({ name, value }) => (value ? jar.set(name, value) : jar.delete(name))),
    },
  });
  return { client, cookieHeader: () => [...jar.entries()].map(([n, v]) => `${n}=${encodeURIComponent(v)}`).join('; ') };
}
const api = (path, cookie, body) =>
  fetch(`${APP}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify(body ?? {}) });

async function main() {
  console.log(`\n▶ E2E part 2 against ${APP}\n`);
  const alex = makeSession();
  const sam = makeSession(); // the invited co-interviewer, signed in as the second account
  await alex.client.auth.signInWithPassword(INTERVIEWER);
  await sam.client.auth.signInWithPassword(SECOND);

  console.log('§ Multiple interviewers per candidate');
  const create = await (await api('/api/sessions', alex.cookieHeader(), {
    candidateName: 'Marcus Lee',
    problemTitle: 'Valid Parentheses',
    difficulty: 'easy',
    description: 'brackets',
    visibleTests: [{ input: 's="()"', expected: 'true' }],
    hiddenTests: [{ input: 's="(]"', expected: 'false' }],
    inviteEmails: [SECOND.email], // invite the 2nd account as co-interviewer
  })).json();
  ok('session created with co-interviewer invite', !!create.sessionId, create.error);
  const { sessionId, roomKey } = create;

  const samJoin = await (await api('/api/join', sam.cookieHeader(), { key: roomKey })).json();
  ok('INVITED account joins as INTERVIEWER (not candidate)', samJoin.role === 'interviewer', `got ${samJoin.role}`);

  // co-interviewer can see hidden tests + write rubric (interviewer powers)
  const { data: samTests } = await sam.client.from('pl_test_cases').select('hidden').eq('session_id', sessionId);
  ok('co-interviewer sees hidden tests', (samTests ?? []).some((t) => t.hidden), `rows=${(samTests ?? []).length}`);
  const samUser = (await sam.client.auth.getUser()).data.user.id;
  const rub = await sam.client.from('pl_rubric_scores').upsert(
    { session_id: sessionId, interviewer_id: samUser, criterion: 'Code quality', score: 3 },
    { onConflict: 'session_id,interviewer_id,criterion' }
  );
  ok('co-interviewer can score rubric', !rub.error, rub.error?.message);

  // two interviewers now on the roster
  const { data: roster } = await alex.client.from('pl_session_participants').select('role').eq('session_id', sessionId);
  const interviewers = (roster ?? []).filter((r) => r.role === 'interviewer').length;
  ok('roster has 2 interviewers', interviewers === 2, `interviewers=${interviewers}`);

  console.log('\n§ Assign problem from bank (/api/sessions/[id]/assign)');
  const { data: bank } = await alex.client.from('pl_problems').select('id,title').eq('number', 56).maybeSingle();
  const assign = await api(`/api/sessions/${sessionId}/assign`, alex.cookieHeader(), { problemId: bank.id });
  ok('interviewer assigns a bank problem', assign.ok, `status ${assign.status}`);
  const { data: after } = await alex.client.from('pl_sessions').select('problem_title,difficulty').eq('id', sessionId).single();
  ok('session problem updated to Merge Intervals', after.problem_title === 'Merge Intervals' && after.difficulty === 'medium', JSON.stringify(after));
  const { data: newTests } = await alex.client.from('pl_test_cases').select('id').eq('session_id', sessionId);
  ok('test cases replaced for the new problem', (newTests ?? []).length > 0, `rows=${(newTests ?? []).length}`);

  console.log('\n§ Assign authorization');
  const visitor = makeSession(); // never signs in
  const visitorAssign = await api(`/api/sessions/${sessionId}/assign`, visitor.cookieHeader(), { problemId: bank.id });
  ok('signed-out visitor cannot assign a problem', visitorAssign.status === 401, `status ${visitorAssign.status}`);

  await alex.client.from('pl_sessions').delete().eq('id', sessionId);
  console.log(`\n${fail === 0 ? '✅ ALL PASSED' : '❌ FAILURES'} — ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
