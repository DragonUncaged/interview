'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase/client';
import { Logo } from '@/components/Logo';
import { T } from '@/lib/theme';

export default function LoginPage() {
  const router = useRouter();
  const supabase = supabaseBrowser();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user && !user.is_anonymous) router.replace('/dashboard');
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (mode === 'signup') {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { display_name: name.trim() || email.split('@')[0] } },
        });
        if (error) throw error;
        if (!data.session) {
          setNotice('Check your inbox to confirm your email, then sign in.');
          setMode('signin');
          return;
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
      router.replace('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ height: '100vh', display: 'flex', fontFamily: T.fontUI, color: T.text }}>
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: 48,
          background: 'radial-gradient(120% 120% at 0% 0%, #10233f 0%, #0a0e15 55%)',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <div style={{ position: 'relative', zIndex: 2 }}>
          <Logo size={18} fontSize={16} spacing={4} />
        </div>
        <div style={{ position: 'relative', zIndex: 2 }}>
          <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: 2, color: T.green, marginBottom: 16 }}>
            TECHNICAL INTERVIEWS, IN SYNC
          </div>
          <h1 style={{ margin: 0, fontSize: 42, lineHeight: 1.14, fontWeight: 600, letterSpacing: -1, maxWidth: '15ch' }}>
            Run live coding interviews that feel like pairing.
          </h1>
          <p style={{ margin: '20px 0 0', fontSize: 15, color: T.textMuted, lineHeight: 1.6, maxWidth: '44ch' }}>
            A shared editor, whiteboard, and hidden test cases — with line-level highlights so the candidate always
            knows where you&apos;re looking.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 26, fontSize: 12, color: T.textFaint, position: 'relative', zIndex: 2 }}>
          <span>Live cursors</span>
          <span>Whiteboard</span>
          <span>Hidden tests</span>
          <span>Line pins</span>
        </div>
        <div
          style={{
            position: 'absolute',
            right: -90,
            bottom: -90,
            width: 300,
            height: 300,
            border: '1px solid rgba(61,220,151,0.14)',
            borderRadius: '50%',
          }}
        />
        <div
          style={{
            position: 'absolute',
            right: -40,
            bottom: -40,
            width: 210,
            height: 210,
            border: '1px solid rgba(61,220,151,0.09)',
            borderRadius: '50%',
          }}
        />
      </div>

      <div
        style={{
          width: 460,
          flex: '0 0 460px',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: '0 56px',
          background: T.bgPanel,
          borderLeft: `1px solid ${T.borderSoft}`,
        }}
      >
        <h2 style={{ margin: '0 0 6px', fontSize: 24, fontWeight: 600 }}>
          {mode === 'signin' ? 'Interviewer sign in' : 'Create interviewer account'}
        </h2>
        <p style={{ margin: '0 0 28px', fontSize: 13, color: T.textMuted }}>
          {mode === 'signin'
            ? 'Welcome back. Set up a room and invite a candidate.'
            : 'Interviewer accounts need a verified email.'}
        </p>
        <form onSubmit={submit}>
          {mode === 'signup' && (
            <>
              <label className="pl-label">FULL NAME</label>
              <input
                className="pl-input"
                style={{ margin: '7px 0 18px' }}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Alex Chen"
              />
            </>
          )}
          <label className="pl-label">EMAIL</label>
          <input
            className="pl-input"
            type="email"
            required
            style={{ margin: '7px 0 18px' }}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="alex.chen@parallel.dev"
          />
          <label className="pl-label">PASSWORD</label>
          <input
            className="pl-input"
            type="password"
            required
            minLength={8}
            style={{ margin: '7px 0 24px' }}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
          />
          {error && <div style={{ fontSize: 12, color: T.redSoft, margin: '-12px 0 14px' }}>{error}</div>}
          {notice && <div style={{ fontSize: 12, color: T.blueSoft, margin: '-12px 0 14px' }}>{notice}</div>}
          <button className="pl-btn pl-btn-primary" style={{ width: '100%' }} disabled={busy} type="submit">
            {busy ? 'Working…' : mode === 'signin' ? 'Sign in' : 'Create account'}
          </button>
        </form>
        <button
          className="pl-btn"
          onClick={() => {
            setMode(mode === 'signin' ? 'signup' : 'signin');
            setError(null);
          }}
          style={{ marginTop: 14, background: 'none', border: 'none', fontSize: 12, color: T.textMuted, cursor: 'pointer' }}
        >
          {mode === 'signin' ? 'No account? Create one →' : '← Back to sign in'}
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '22px 0' }}>
          <span style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.08)' }} />
          <span style={{ fontSize: 11, color: T.textFaint }}>OR</span>
          <span style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.08)' }} />
        </div>
        <button
          className="pl-btn pl-btn-ghost"
          style={{ width: '100%', fontSize: 13, fontWeight: 600, color: T.textSoft, padding: 12, borderRadius: 9 }}
          onClick={() => router.push('/join')}
        >
          Joining as a candidate? Enter a room key →
        </button>
      </div>
    </div>
  );
}
