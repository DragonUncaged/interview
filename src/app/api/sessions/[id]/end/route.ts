import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { broadcastToSession } from '@/lib/broadcast';
import { clientIp, rateLimit } from '@/lib/ratelimit';
import { isUuid } from '@/lib/validation';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await rateLimit(`end:${clientIp(req)}`, 20, 60_000))) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: 'Bad request' }, { status: 400 });

  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'not_authenticated' }, { status: 401 });

  // RLS lets only this session's interviewers update it.
  const { data, error } = await supabase
    .from('pl_sessions')
    .update({ status: 'completed', ended_at: new Date().toISOString() })
    .eq('id', id)
    .neq('status', 'completed')
    .select('id')
    .maybeSingle();

  if (error) {
    console.error('Failed to end session:', { error, sessionId: id });
    return NextResponse.json({ error: 'Could not end this session' }, { status: 400 });
  }
  if (!data) return NextResponse.json({ error: 'forbidden_or_already_ended' }, { status: 403 });

  await broadcastToSession(id, 'session', { type: 'ended' });
  return NextResponse.json({ ok: true });
}
