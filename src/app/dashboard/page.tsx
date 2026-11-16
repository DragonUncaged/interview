'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase/client';
import { Logo } from '@/components/Logo';
import { T, ROLE_COLORS, initials, diffMeta } from '@/lib/theme';
import { SESSION_COLUMNS, type Session } from '@/lib/types';

function statusMeta(s: Session) {
  if (s.status === 'live') return { label: 'Live now', color: T.green, bg: 'rgba(61,220,151,0.12)', btn: 'Join' };
  if (s.status === 'completed')
    return { label: 'Completed', color: T.textMuted, bg: 'rgba(255,255,255,0.05)', btn: 'Review' };
  return { label: 'Scheduled', color: T.blueSoft, bg: 'rgba(91,140,255,0.12)', btn: 'Open' };
}

function when(s: Session): string {
  const d = new Date(s.status === 'completed' ? (s.ended_at ?? s.created_at) : (s.started_at ?? s.created_at));
  const mins = Math.max(0, Math.round((Date.now() - d.getTime()) / 60000));
  if (s.status === 'live') return mins < 60 ? `Started ${mins}m ago` : `Started ${Math.round(mins / 60)}h ago`;
  const day = d.toDateString() === new Date().toDateString() ? 'Today' : d.toLocaleDateString();
  return `${day} · ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
}

export default function DashboardPage() {
  const router = useRouter();
  const supabase = supabaseBrowser();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [userName, setUserName] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user || user.is_anonymous) {
        router.replace('/');
        return;
      }
      setUserName((user.user_metadata?.display_name as string) || user.email?.split('@')[0] || 'Interviewer');
      const { data } = await supabase.from('pl_sessions').select(SESSION_COLUMNS).order('created_at', { ascending: false });
      setSessions((data as unknown as Session[]) ?? []);
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const scheduled = sessions.filter((s) => s.status === 'scheduled').length;

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: T.bg, color: T.text, fontFamily: T.fontUI }}>
      <header
        style={{
          height: 58,
          flex: '0 0 58px',
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          padding: '0 22px',
          borderBottom: `1px solid ${T.border}`,
          background: T.bgHeader,
        }}
      >
        <Logo />
        <div style={{ flex: 1 }} />
        <button
          className="pl-btn"
          onClick={() => router.push('/setup')}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 7,
            fontSize: 13,
            fontWeight: 600,
            color: T.greenDark,
            background: T.green,
            padding: '9px 15px',
            borderRadius: 9,
            boxShadow: '0 0 14px rgba(61,220,151,0.28)',
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={T.greenDark} strokeWidth="2.5">
            <path d="M12 5v14M5 12h14" />
          </svg>
          New interview
        </button>
        <div style={{ width: 1, height: 26, background: 'rgba(255,255,255,0.08)' }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <div
            style={{
              width: 30,
              height: 30,
              borderRadius: '50%',
              background: ROLE_COLORS.interviewer.avBg,
              border: `2px solid ${T.green}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 11,
              fontWeight: 600,
              color: T.greenSoft,
            }}
          >
            {initials(userName)}
          </div>
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 600 }}>{userName}</div>
            <div style={{ fontSize: 10, color: T.textFaint }}>Interviewer</div>
          </div>
        </div>
        <button
          className="pl-btn pl-btn-ghost"
          onClick={async () => {
            await supabase.auth.signOut();
            router.replace('/');
          }}
        >
          Sign out
        </button>
      </header>

      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <nav
          style={{
            width: 210,
            flex: '0 0 210px',
            padding: '20px 14px',
            borderRight: `1px solid ${T.borderSoft}`,
            background: T.bgPanel,
            display: 'flex',
            flexDirection: 'column',
            gap: 3,
          }}
        >
          <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: 1, color: T.textFaint, padding: '6px 10px' }}>
            WORKSPACE
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              fontSize: 13,
              color: T.text,
              background: 'rgba(61,220,151,0.1)',
              padding: '9px 10px',
              borderRadius: 8,
              fontWeight: 600,
            }}
          >
            <span style={{ width: 6, height: 6, borderRadius: 2, background: T.green }} />
            Interviews
          </div>
          {['Schedule', 'Question bank', 'Analytics'].map((item) => (
            <div
              key={item}
              title="Coming soon"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                fontSize: 13,
                color: T.textMuted,
                padding: '9px 10px',
                borderRadius: 8,
              }}
            >
              <span style={{ width: 6, height: 6, borderRadius: '50%', border: `1px solid ${T.textFaint}` }} />
              {item}
            </div>
          ))}
          <div style={{ flex: 1 }} />
          <div
            style={{
              fontSize: 11,
              color: T.textMuted,
              padding: 12,
              lineHeight: 1.5,
              border: `1px solid ${T.borderSoft}`,
              borderRadius: 10,
              background: T.bg,
            }}
          >
            {scheduled} interview{scheduled === 1 ? '' : 's'} scheduled
          </div>
        </nav>

        <main style={{ flex: 1, overflowY: 'auto', padding: '28px 32px' }}>
          <h1 style={{ margin: '0 0 4px', fontSize: 24, fontWeight: 600, letterSpacing: -0.3 }}>Interviews</h1>
          <p style={{ margin: '0 0 24px', fontSize: 13, color: T.textMuted }}>
            Create a room, set the problem and test cases, then share the connect key with your candidate.
          </p>
          {loading ? (
            <div style={{ color: T.textFaint, fontSize: 13 }}>Loading…</div>
          ) : sessions.length === 0 ? (
            <div
              style={{
                border: `1px dashed rgba(255,255,255,0.14)`,
                borderRadius: 12,
                padding: 40,
                textAlign: 'center',
                color: T.textMuted,
                fontSize: 13,
              }}
            >
              No interviews yet — create your first room with “New interview”.
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(320px,1fr))', gap: 16 }}>
              {sessions.map((s) => {
                const sm = statusMeta(s);
                const dm = diffMeta(s.difficulty);
                return (
                  <div
                    key={s.id}
                    style={{ background: T.bgCard, border: `1px solid ${T.border}`, borderRadius: 12, padding: 18 }}
                  >
                    <div
                      style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}
                    >
                      <span
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                          fontSize: 11,
                          fontWeight: 600,
                          color: sm.color,
                          background: sm.bg,
                          padding: '3px 10px',
                          borderRadius: 20,
                        }}
                      >
                        {sm.label}
                      </span>
                      <span style={{ fontFamily: T.fontMono, fontSize: 11, color: T.blueSoft }}>{s.room_key}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginBottom: 14 }}>
                      <div
                        style={{
                          width: 36,
                          height: 36,
                          borderRadius: '50%',
                          background: ROLE_COLORS.candidate.avBg,
                          border: `2px solid ${T.blue}`,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: 12,
                          fontWeight: 600,
                          color: T.blueSoft,
                        }}
                      >
                        {initials(s.candidate_name)}
                      </div>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 600 }}>{s.candidate_name}</div>
                        <div style={{ fontSize: 11, color: T.textFaint }}>{s.candidate_role_label}</div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                      <span style={{ fontSize: 12.5, color: T.textSoft }}>
                        {s.problem_number ? `${s.problem_number}. ` : ''}
                        {s.problem_title}
                      </span>
                      <span
                        style={{
                          fontSize: 9,
                          fontWeight: 700,
                          letterSpacing: 0.5,
                          color: dm.color,
                          background: dm.bg,
                          padding: '2px 7px',
                          borderRadius: 20,
                        }}
                      >
                        {s.difficulty.toUpperCase()}
                      </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: 11, color: T.textFaint }}>{when(s)}</span>
                      <button
                        className="pl-btn"
                        onClick={() => router.push(`/studio/${s.id}`)}
                        style={{
                          fontSize: 12,
                          fontWeight: 600,
                          color: T.greenDark,
                          background: T.green,
                          padding: '7px 16px',
                          borderRadius: 8,
                        }}
                      >
                        {sm.btn}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
