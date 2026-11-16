import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { clientIp, rateLimit } from '@/lib/ratelimit';
import { isRoomKey, normalizeKey } from '@/lib/keys';

const JOIN_ERRORS = ['invalid_key', 'seat_taken', 'session_completed'];

/** Join a room by connect key. The role is decided inside pl_join_session (SECURITY
 *  DEFINER); the client never sends one, and a key alone only yields the candidate seat. */
export async function POST(req: Request) {
  if (!(await rateLimit(`join:${clientIp(req)}`, 10, 60_000))) {
    return NextResponse.json({ error: 'Too many attempts. Wait a minute and try again.' }, { status: 429 });
  }

  let body: { key?: string; name?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 });
  }
  const key = normalizeKey(body.key ?? '');
  if (!isRoomKey(key)) return NextResponse.json({ error: 'invalid_key' }, { status: 400 });

  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'not_authenticated' }, { status: 401 });

  const { data, error } = await supabase.rpc('pl_join_session', {
    p_key: key,
    p_display_name: (body.name ?? '').slice(0, 80) || null,
  });
  if (error) {
    const code = JOIN_ERRORS.find((c) => error.message.includes(c)) ?? 'join_failed';
    return NextResponse.json({ error: code }, { status: 403 });
  }

  return NextResponse.json({ sessionId: data.session_id, role: data.role });
}
