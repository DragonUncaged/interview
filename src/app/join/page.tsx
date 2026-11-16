'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase/client';
import { Logo } from '@/components/Logo';
import { T } from '@/lib/theme';

const ERROR_TEXT: Record<string, string> = {
  invalid_key: "That key doesn't match an open room. Check with your interviewer.",
  seat_taken: 'The candidate seat for this room is already taken.',
  session_completed: 'This interview has already ended.',
  not_signed_in: 'Interviewers must sign in first. Use the link below.',
  not_invited: 'This account is not an interviewer for this room. Ask the creator to invite your email.',
  not_participant: "You're not in that room. Enter its connect key to join.",
  not_authenticated: "You're signed out. Sign in as an interviewer, or enter the connect key to join.",
  join_failed: 'Could not join the room. Try again.',
};

function JoinInner() {
  const router = useRouter();
  const params = useSearchParams();
  const supabase = supabaseBrowser();
  const [joinRole, setJoinRole] = useState<'candidate' | 'interviewer'>('candidate');
  const [key, setKey] = useState(params.get('key') ?? '');
  const [name, setName] = useState('');
  // Only known codes from the URL, so a crafted link can't display arbitrary text.
  const [error, setError] = useState<string | null>(() => {
    const code = params.get('error');
    return code && Object.hasOwn(ERROR_TEXT, code) ? code : null;
  });
  const [busy, setBusy] = useState(false);
  const [signedInEmail, setSignedInEmail] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user && !user.is_anonymous) setSignedInEmail(user.email ?? null);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (joinRole === 'interviewer') {
        // UX routing only; the server decides the actual role.
        if (!user || user.is_anonymous) {
          setError('not_signed_in');
          setBusy(false);
          return;
        }
      } else if (!user) {
        const { error: anonErr } = await supabase.auth.signInAnonymously({
          options: { data: { display_name: name.trim() || 'Candidate' } },
        });
        if (anonErr) throw new Error(anonErr.message);
      }

      const res = await fetch('/api/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, name: name.trim() || undefined }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? 'join_failed');
        setBusy(false);
        return;
      }
      if (joinRole === 'interviewer' && json.role !== 'interviewer') {
        // Valid key but not invited: they were seated as candidate, so say so.
        setError('not_invited');
        setBusy(false);
        return;
      }
      router.push(`/studio/${json.sessionId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'join_failed');
      setBusy(false);
    }
  }

  const seg = (active: boolean): React.CSSProperties => ({
    flex: 1,
    justifyContent: 'center',
    fontFamily: 'inherit',
    fontSize: 12,
    fontWeight: active ? 600 : 500,
    color: active ? T.greenDark : T.textMuted,
    background: active ? T.green : 'transparent',
    border: 'none',
    padding: '6px 13px',
    borderRadius: 7,
    cursor: 'pointer',
  });

  const errText = error ? (Object.hasOwn(ERROR_TEXT, error) ? ERROR_TEXT[error] : error) : null;

  return (
    <div
      style={{
        height: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'radial-gradient(120% 120% at 50% 0%, #10233f 0%, #0a0e15 55%)',
        color: T.text,
        fontFamily: T.fontUI,
      }}
    >
      <div style={{ width: 440 }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 26 }}>
          <Logo size={16} fontSize={15} spacing={4} />
        </div>
        <div style={{ background: T.bgPanel, border: '1px solid rgba(255,255,255,0.08)', borderRadius: 16, padding: 32 }}>
          <h2 style={{ margin: '0 0 6px', fontSize: 22, fontWeight: 600, textAlign: 'center' }}>Join interview room</h2>
          <p style={{ margin: '0 0 22px', fontSize: 13, color: T.textMuted, textAlign: 'center' }}>
            Enter the connect key your interviewer shared.
          </p>
          <div style={{ display: 'flex', background: T.bg, border: `1px solid ${T.borderInput}`, borderRadius: 10, padding: 3, marginBottom: 18 }}>
            <button style={seg(joinRole === 'candidate')} onClick={() => setJoinRole('candidate')}>
              Candidate
            </button>
            <button style={seg(joinRole === 'interviewer')} onClick={() => setJoinRole('interviewer')}>
              Interviewer
            </button>
          </div>
          {joinRole === 'candidate' && (
            <>
              <label className="pl-label">YOUR NAME</label>
              <input
                className="pl-input pl-input--blue"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Priya Nair"
                style={{ margin: '8px 0 16px' }}
              />
            </>
          )}
          {joinRole === 'interviewer' && (
            <div style={{ fontSize: 12, color: signedInEmail ? T.blueSoft : T.textMuted, margin: '0 0 16px', lineHeight: 1.5 }}>
              {signedInEmail
                ? `Signed in as ${signedInEmail}. You'll enter as interviewer if this room belongs to you or your email was invited.`
                : 'You need a signed-in interviewer account for this.'}
            </div>
          )}
          <label className="pl-label">CONNECT KEY</label>
          <input
            value={key}
            onChange={(e) => {
              setKey(e.target.value.toUpperCase());
              setError(null);
            }}
            onKeyDown={(e) => e.key === 'Enter' && !busy && submit()}
            placeholder="PXR-7K4QM2"
            style={{
              margin: '8px 0 0',
              width: '100%',
              textAlign: 'center',
              letterSpacing: 5,
              textTransform: 'uppercase',
              background: T.bg,
              border: `1px solid ${errText ? T.redSoft : 'rgba(255,255,255,0.12)'}`,
              borderRadius: 10,
              padding: 14,
              color: T.text,
              fontFamily: T.fontMono,
              fontSize: 20,
              fontWeight: 600,
              outline: 'none',
            }}
          />
          {errText && (
            <div role="alert" style={{ fontSize: 12, color: T.redSoft, margin: '8px 2px 0' }}>
              {errText}
            </div>
          )}
          <button className="pl-btn pl-btn-primary" style={{ marginTop: 18, width: '100%', borderRadius: 10 }} onClick={submit} disabled={busy || key.trim().length < 4}>
            {busy ? 'Joining…' : 'Join room'}
          </button>
        </div>
        <div style={{ textAlign: 'center', marginTop: 18 }}>
          <button
            className="pl-btn"
            onClick={() => router.push('/')}
            style={{ fontSize: 12, color: T.textMuted, background: 'none', border: 'none' }}
          >
            ← Back to sign in
          </button>
        </div>
      </div>
    </div>
  );
}

export default function JoinPage() {
  return (
    <Suspense>
      <JoinInner />
    </Suspense>
  );
}
