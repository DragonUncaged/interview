import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { broadcastToSession } from '@/lib/broadcast';
import { clientIp, rateLimit } from '@/lib/ratelimit';
import { isUuid } from '@/lib/validation';

const ASSIGN_ERRORS: Record<string, { status: number; message: string }> = {
  forbidden: { status: 403, message: 'Only interviewers can assign problems from their own bank.' },
  problem_not_found: { status: 404, message: 'Problem not found.' },
  session_completed: { status: 409, message: 'This session has ended.' },
};

/** Assign a bank problem to a live session. pl_assign_problem checks the caller is an
 *  interviewer and swaps the problem, test cases and hint reveals in one transaction. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await rateLimit(`assign:${clientIp(req)}`, 20, 60_000))) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: 'Bad request' }, { status: 400 });

  let body: { problemId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 });
  }
  if (!isUuid(body.problemId)) return NextResponse.json({ error: 'Bad request' }, { status: 400 });

  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'not_authenticated' }, { status: 401 });

  // Per-session limit sits after auth so anonymous traffic can't use up a real session's budget.
  if (!(await rateLimit(`assign-session:${id}`, 1, 2_000))) {
    return NextResponse.json({ error: 'That problem is still being assigned.' }, { status: 429 });
  }

  const { error } = await supabase.rpc('pl_assign_problem', { p_session_id: id, p_problem_id: body.problemId });
  if (error) {
    const known = Object.keys(ASSIGN_ERRORS).find((code) => error.message.includes(code));
    if (known) return NextResponse.json({ error: ASSIGN_ERRORS[known].message }, { status: ASSIGN_ERRORS[known].status });
    console.error('Failed to assign problem:', { error, sessionId: id });
    return NextResponse.json({ error: 'Could not assign this problem' }, { status: 400 });
  }

  await broadcastToSession(id, 'session', { type: 'problem_assigned' });
  return NextResponse.json({ ok: true });
}
