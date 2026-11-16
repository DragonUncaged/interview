import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { broadcastToSession } from '@/lib/broadcast';
import { runTests } from '@/lib/sandbox';
import { rateLimit } from '@/lib/ratelimit';
import { LANGS } from '@/lib/langs';
import { MAX_TESTS, isUuid } from '@/lib/validation';
import type { LangId, RunSummary } from '@/lib/types';

/** Run the code against every test case. Hidden cases are read with the service role
 *  and their details go to pl_run_hidden_results (interviewer-only); candidates get counts only. */
export async function POST(req: Request) {
  let body: { sessionId?: string; language?: LangId; code?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 });
  }

  const { sessionId, language, code } = body;
  if (!isUuid(sessionId) || typeof code !== 'string' || !language || !LANGS[language]) {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 });
  }
  if (code.length > 64_000) {
    return NextResponse.json({ error: 'Code too large' }, { status: 413 });
  }

  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'not_authenticated' }, { status: 401 });

  const { data: me } = await supabase
    .from('pl_session_participants')
    .select('role')
    .eq('session_id', sessionId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!me) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const [sessionOk, userOk] = await Promise.all([
    rateLimit(`run:${sessionId}`, 1, 2_000),
    rateLimit(`run-user:${user.id}`, 10, 60_000),
  ]);
  if (!sessionOk || !userOk) {
    return NextResponse.json({ error: 'Slow down — a run is already in flight.' }, { status: 429 });
  }

  const admin = supabaseAdmin();
  const { data: session } = await admin
    .from('pl_sessions')
    .select('id,status,starter_code')
    .eq('id', sessionId)
    .single();
  if (!session || session.status === 'completed') {
    return NextResponse.json({ error: 'Session is closed' }, { status: 409 });
  }

  const { data: cases } = await admin
    .from('pl_test_cases')
    .select('id,position,input,expected,hidden')
    .eq('session_id', sessionId)
    .order('hidden', { ascending: true })
    .order('position', { ascending: true });
  if (!cases?.length) return NextResponse.json({ error: 'No test cases configured' }, { status: 409 });

  await broadcastToSession(sessionId, 'run', { state: 'running', by: user.id });

  // Entry-function name from the starter, so `const solve = () => …` is found too.
  const starter = (session.starter_code as Record<string, string> | null)?.[language] ?? '';
  const hintMatch = starter.match(/(?:function\*?|def)\s+([A-Za-z_$][\w$]*)/) ?? starter.match(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/);
  const entryHint = hintMatch?.[1];

  // Separate processes: a visible case's output must never be able to carry hidden data.
  const visibleCases = cases.filter((c) => !c.hidden).slice(0, MAX_TESTS);
  const hiddenCases = cases.filter((c) => c.hidden).slice(0, MAX_TESTS);

  let visOutcome, hidOutcome;
  try {
    [visOutcome, hidOutcome] = await Promise.all([
      runTests(language, code, visibleCases, entryHint),
      runTests(language, code, hiddenCases, entryHint),
    ]);
  } catch (e) {
    console.error('Sandbox execution failed:', { error: e, sessionId });
    await broadcastToSession(sessionId, 'run', { state: 'error' });
    return NextResponse.json({ error: 'Execution failed' }, { status: 502 });
  }

  const visibleResults = visOutcome.results;
  const hiddenResults = hidOutcome.results;

  const summary: RunSummary = {
    passed: visibleResults.filter((r) => r.pass).length,
    total: visibleResults.length,
    hiddenPassed: hiddenResults.filter((r) => r.pass).length,
    hiddenTotal: hiddenResults.length,
    timeMs: visOutcome.timeMs + hidOutcome.timeMs,
  };

  // A hidden run's error can quote a hidden input, so only the visible error is shared.
  const candidateError = visOutcome.error;

  const { data: run, error: runErr } = await admin
    .from('pl_runs')
    .insert({
      session_id: sessionId,
      triggered_by: user.id,
      language,
      code,
      status: candidateError || hidOutcome.error ? 'error' : 'done',
      summary,
      visible_results: visibleResults,
      error: candidateError,
    })
    .select('id,created_at')
    .single();
  if (runErr) {
    console.error('Failed to persist run:', { error: runErr, sessionId });
    await broadcastToSession(sessionId, 'run', { state: 'error' });
    return NextResponse.json({ error: 'Could not save this run' }, { status: 500 });
  }

  if (hiddenResults.length) {
    const { error: hidErr } = await admin.from('pl_run_hidden_results').insert({
      run_id: run.id,
      session_id: sessionId,
      details: hiddenResults,
    });
    if (hidErr) console.error('Failed to persist hidden results:', { error: hidErr, sessionId });
  }

  // Clients re-read the run row under their own RLS, so the broadcast carries only its id.
  await broadcastToSession(sessionId, 'run', { state: 'done', runId: run.id });

  const base = { runId: run.id, summary, visibleResults, error: candidateError };
  if (me.role === 'interviewer') {
    return NextResponse.json({ ...base, hiddenResults });
  }
  return NextResponse.json(base);
}
