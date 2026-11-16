import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { generateRoomKey, isRoomKey } from '@/lib/keys';
import { clientIp, rateLimit } from '@/lib/ratelimit';
import { LANG_IDS } from '@/lib/langs';
import { toTestRows, type TestPair } from '@/lib/testCases';
import { MAX_TEST_FIELD_LEN, MAX_TESTS, isUuid, isValidEmail } from '@/lib/validation';
import type { Difficulty, LangId } from '@/lib/types';

interface CreateBody {
  candidateName?: string;
  candidateRoleLabel?: string;
  problemId?: string | null;
  problemNumber?: number | null;
  problemTitle?: string;
  difficulty?: Difficulty;
  description?: string;
  followUp?: string | null;
  tags?: string[];
  hints?: string[];
  starterCode?: Partial<Record<LangId, string>>;
  visibleTests?: TestPair[];
  hiddenTests?: TestPair[];
  inviteEmails?: string[];
  roomKey?: string;
}

const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard'];
const MAX_STARTER_LEN = 50_000;

const str = (v: unknown, max: number, fallback = '') => (typeof v === 'string' ? v : fallback).slice(0, max);

/** Keeps non-empty pairs. Returns null if any field is over the limit: cutting a
 *  test case short would make it grade wrong, so it is rejected instead. */
function cleanTests(raw: unknown): TestPair[] | null {
  const out: TestPair[] = [];
  for (const t of (Array.isArray(raw) ? raw : []).slice(0, MAX_TESTS)) {
    const input = typeof t?.input === 'string' ? t.input : '';
    const expected = typeof t?.expected === 'string' ? t.expected : '';
    if (input.length > MAX_TEST_FIELD_LEN || expected.length > MAX_TEST_FIELD_LEN) return null;
    if (input.trim() || expected.trim()) out.push({ input, expected });
  }
  return out;
}

/** Create a session as the signed-in user (RLS applies), then register them as interviewer. */
export async function POST(req: Request) {
  if (!(await rateLimit(`create:${clientIp(req)}`, 20, 60_000))) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  let body: CreateBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 });
  }

  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'not_authenticated' }, { status: 401 });
  if (user.is_anonymous) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const visible = cleanTests(body.visibleTests);
  const hidden = cleanTests(body.hiddenTests);
  if (!visible || !hidden) {
    return NextResponse.json(
      { error: `Each test input and expected output must be under ${MAX_TEST_FIELD_LEN} characters.` },
      { status: 400 }
    );
  }

  const difficulty = DIFFICULTIES.includes(body.difficulty as Difficulty) ? (body.difficulty as Difficulty) : 'easy';

  const starterCode: Partial<Record<LangId, string>> = {};
  for (const lang of LANG_IDS) {
    const code = body.starterCode?.[lang];
    if (typeof code === 'string') starterCode[lang] = code.slice(0, MAX_STARTER_LEN);
  }

  // A bank problem's hints and hidden tests come from the database, never from the
  // request. Only builtins (owner_id null) or the caller's own problems.
  let problemId: string | null = null;
  let hints = (Array.isArray(body.hints) ? body.hints : []).slice(0, 6).map((h) => str(h, 500));
  if (isUuid(body.problemId)) {
    const { data: prob, error: probErr } = await supabaseAdmin()
      .from('pl_problems')
      .select('owner_id,hints,hidden_tests')
      .eq('id', body.problemId)
      .maybeSingle<{ owner_id: string | null; hints: unknown[] | null; hidden_tests: TestPair[] | null }>();
    if (probErr) {
      console.error('Failed to read bank problem:', { error: probErr, problemId: body.problemId });
      return NextResponse.json({ error: 'Could not load that problem' }, { status: 500 });
    }
    if (prob && (prob.owner_id === null || prob.owner_id === user.id)) {
      problemId = body.problemId;
      // Copied as-is, like pl_assign_problem does: a cut-short test would grade wrong,
      // while an oversized one makes the sandbox report a visible error.
      hints = (prob.hints ?? []).map(String);
      for (const t of prob.hidden_tests ?? []) {
        if (hidden.length >= MAX_TESTS) break;
        hidden.push({ input: String(t?.input ?? ''), expected: String(t?.expected ?? '') });
      }
    }
  }

  // The client's preview key is kept only if it has full entropy; regenerate on collision.
  let roomKey = isRoomKey(body.roomKey) ? body.roomKey : generateRoomKey();
  let sessionId: string | null = null;
  for (let attempt = 0; attempt < 3 && !sessionId; attempt++) {
    const { data, error } = await supabase
      .from('pl_sessions')
      .insert({
        created_by: user.id,
        room_key: roomKey,
        candidate_name: str(body.candidateName, 80).trim() || 'Candidate',
        candidate_role_label: str(body.candidateRoleLabel, 120),
        problem_id: problemId,
        problem_number: typeof body.problemNumber === 'number' ? body.problemNumber : null,
        problem_title: str(body.problemTitle, 200).trim() || 'Untitled problem',
        difficulty,
        description: str(body.description, 20_000),
        follow_up: body.followUp ? str(body.followUp, 2000) : null,
        tags: (Array.isArray(body.tags) ? body.tags : []).slice(0, 8).map((t) => str(t, 40)),
        hints,
        starter_code: starterCode,
        language: 'python',
      })
      .select('id')
      .single();

    if (!error) sessionId = data.id;
    else if (error.code === '23505') roomKey = generateRoomKey();
    else {
      console.error('Failed to create session:', { error });
      return NextResponse.json({ error: 'Could not create the session' }, { status: 400 });
    }
  }
  if (!sessionId) return NextResponse.json({ error: 'Could not create the session' }, { status: 500 });

  // The creator path inside pl_join_session makes the caller interviewer.
  const { error: joinErr } = await supabase.rpc('pl_join_session', { p_key: roomKey, p_display_name: null });
  if (joinErr) {
    console.error('Creator join failed:', { error: joinErr, sessionId });
    return NextResponse.json({ error: 'join_failed' }, { status: 500 });
  }

  // Test-case writes are interviewer-only under RLS, which holds now that we've joined.
  const rows = toTestRows(sessionId, visible, hidden);
  if (rows.length) {
    const { error: tcErr } = await supabase.from('pl_test_cases').insert(rows);
    if (tcErr) {
      console.error('Failed to write test cases on create:', { error: tcErr, sessionId });
      return NextResponse.json({ error: 'Could not save the test cases' }, { status: 400 });
    }
  }

  const emails = (Array.isArray(body.inviteEmails) ? body.inviteEmails : [])
    .map((e) => str(e, 254).trim().toLowerCase())
    .filter(isValidEmail)
    .slice(0, 10);
  if (emails.length) {
    const { error: invErr } = await supabase
      .from('pl_session_invites')
      .upsert(
        emails.map((email) => ({ session_id: sessionId, email, invited_by: user.id })),
        { onConflict: 'session_id,email', ignoreDuplicates: true }
      );
    if (invErr) console.error('Failed to save invites:', { error: invErr, sessionId });
  }

  return NextResponse.json({ sessionId, roomKey });
}
