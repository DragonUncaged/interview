'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Logo } from '@/components/Logo';
import { T, ROLE_COLORS, initials, diffMeta } from '@/lib/theme';
import type { SaveState, Studio } from './useStudio';

function useElapsed(startedAt: string | null, running: boolean) {
  const [, force] = useState(0);
  useEffect(() => {
    if (!running) return;
    const iv = setInterval(() => force((x) => x + 1), 1000);
    return () => clearInterval(iv);
  }, [running]);
  if (!startedAt) return '00:00';
  const secs = Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000));
  const m = String(Math.floor(secs / 60)).padStart(2, '0');
  const s = String(secs % 60).padStart(2, '0');
  return `${m}:${s}`;
}

const SAVE_LABEL: Record<SaveState, { text: string; color: string; title: string }> = {
  idle: { text: 'All changes saved', color: T.textMuted, title: 'Code is saved to the room as you type' },
  saving: { text: 'Saving…', color: T.textMuted, title: 'Saving your latest edits' },
  saved: { text: 'Saved', color: T.textMuted, title: 'Code is saved to the room as you type' },
  error: { text: 'Save failed', color: T.redSoft, title: 'The last save failed. Keep typing to retry.' },
};

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function HeaderBar({
  studio,
  viewRole,
  onViewRole,
}: {
  studio: Studio;
  viewRole: 'interviewer' | 'candidate';
  onViewRole: (r: 'interviewer' | 'candidate') => void;
}) {
  const router = useRouter();
  const { session, me, participants, onlineIds } = studio;
  const dm = diffMeta(session?.difficulty ?? 'easy');
  const elapsed = useElapsed(session?.started_at ?? null, session?.status === 'live');
  const save = SAVE_LABEL[studio.saveState];
  const [endState, setEndState] = useState<'idle' | 'confirm' | 'ending' | 'failed'>('idle');
  const [copiedKey, setCopiedKey] = useState(false);

  const isRealInterviewer = me?.role === 'interviewer';
  const roomKey = session?.room_key ?? '';

  async function copy(text: string) {
    if (!(await copyText(text))) return;
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 2000);
  }

  async function shareRoomKey() {
    const url = `${window.location.origin}/join?key=${encodeURIComponent(roomKey)}`;
    if (!navigator.share) return copy(url);
    try {
      await navigator.share({ title: 'Join interview', text: `Join my interview room: ${roomKey}`, url });
    } catch {
      // share sheet dismissed
    }
  }

  const seg = (active: boolean): React.CSSProperties => ({
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

  async function onEnd() {
    if (!isRealInterviewer) {
      router.push('/join');
      return;
    }
    if (endState === 'ending') return;
    if (endState !== 'confirm') {
      setEndState('confirm');
      setTimeout(() => setEndState((s) => (s === 'confirm' ? 'idle' : s)), 3000);
      return;
    }
    setEndState('ending');
    if (await studio.endSession()) {
      router.push('/dashboard');
    } else {
      setEndState('failed');
      setTimeout(() => setEndState((s) => (s === 'failed' ? 'idle' : s)), 3000);
    }
  }

  const endLabel = { idle: 'End', confirm: 'Confirm end?', ending: 'Ending…', failed: 'End failed, retry' }[endState];

  return (
    <header
      style={{
        height: 58,
        flex: '0 0 58px',
        display: 'flex',
        alignItems: 'center',
        gap: 18,
        padding: '0 18px',
        borderBottom: `1px solid ${T.border}`,
        background: T.bgHeader,
      }}
    >
      <div style={{ flexShrink: 0 }}>
        <Logo />
      </div>
      <div style={{ width: 1, height: 26, background: 'rgba(255,255,255,0.08)', flexShrink: 0 }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexShrink: 0 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: T.textSoft, whiteSpace: 'nowrap' }}>
          {session?.problem_number ? `${session.problem_number} · ` : ''}
          {session?.problem_title}
        </span>
        <span
          style={{
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: 0.5,
            color: dm.color,
            background: dm.bg,
            border: `1px solid ${dm.border}`,
            padding: '2px 8px',
            borderRadius: 20,
          }}
        >
          {(session?.difficulty ?? '').toUpperCase()}
        </span>
        {isRealInterviewer && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              className="pl-btn"
              title={copiedKey ? 'Copied to clipboard!' : 'Click to copy room key'}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                fontFamily: T.fontMono,
                fontSize: 11,
                fontWeight: 600,
                color: copiedKey ? T.greenSoft : T.blueSoft,
                background: copiedKey ? 'rgba(91,200,130,0.1)' : 'rgba(91,140,255,0.1)',
                border: `1px solid ${copiedKey ? 'rgba(91,200,130,0.28)' : 'rgba(91,140,255,0.28)'}`,
                padding: '3px 9px',
                borderRadius: 20,
                whiteSpace: 'nowrap',
                transition: 'all 0.2s ease',
              }}
              onClick={() => copy(roomKey)}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: copiedKey ? T.green : T.blue,
                }}
              />
              {copiedKey ? 'Copied!' : roomKey}
            </button>
            <button
              title="Share room key with candidate"
              onClick={shareRoomKey}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 28,
                height: 28,
                borderRadius: 6,
                background: 'rgba(91,140,255,0.08)',
                border: '1px solid rgba(91,140,255,0.2)',
                cursor: 'pointer',
                color: T.blueSoft,
                fontSize: 14,
              }}
            >
              ↗
            </button>
          </div>
        )}
      </div>

      <div style={{ flex: 1 }} />

      {!studio.ended && (
        <div
          title={save.title}
          role="status"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 11,
            fontWeight: 500,
            color: save.color,
            flexShrink: 0,
            whiteSpace: 'nowrap',
          }}
        >
          <span
            style={{
              width: 5,
              height: 5,
              borderRadius: '50%',
              background: studio.saveState === 'error' ? T.red : T.green,
              opacity: studio.saveState === 'saving' ? 0.4 : 0.8,
            }}
          />
          {save.text}
        </div>
      )}

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          background: 'rgba(255,255,255,0.03)',
          border: '1px solid rgba(255,255,255,0.06)',
          borderRadius: 10,
          padding: '6px 12px',
          flexShrink: 0,
        }}
      >
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: session?.status === 'completed' ? T.textFaint : T.red,
            boxShadow: session?.status === 'completed' ? 'none' : '0 0 8px rgba(255,92,108,0.8)',
            animation: session?.status === 'live' ? 'pulse 1.8s ease-in-out infinite' : 'none',
          }}
        />
        <span style={{ fontFamily: T.fontMono, fontSize: 13, fontWeight: 600, letterSpacing: 0.5, color: T.text, minWidth: 44 }}>
          {session?.status === 'completed' ? 'ENDED' : elapsed}
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
        {participants.map((p, i) => {
          const rc = ROLE_COLORS[p.role];
          const online = onlineIds.has(p.user_id);
          return (
            <div
              key={p.id}
              title={`${p.display_name} · ${p.role === 'interviewer' ? 'Interviewer' : 'Candidate'}${online ? '' : ' (offline)'}`}
              style={{
                width: 30,
                height: 30,
                borderRadius: '50%',
                background: rc.avBg,
                border: `2px solid ${rc.color}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 11,
                fontWeight: 600,
                color: rc.soft,
                marginLeft: i > 0 ? -9 : 0,
                opacity: online ? 1 : 0.4,
                position: 'relative',
                zIndex: participants.length - i,
              }}
            >
              {initials(p.display_name)}
            </div>
          );
        })}
      </div>

      {isRealInterviewer && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <span style={{ fontSize: 10, color: T.textFaint, letterSpacing: 0.5, whiteSpace: 'nowrap' }}>VIEW&nbsp;AS</span>
          <div style={{ display: 'flex', background: T.bg, border: `1px solid ${T.borderInput}`, borderRadius: 9, padding: 2 }}>
            <button style={seg(viewRole === 'interviewer')} onClick={() => onViewRole('interviewer')}>
              Interviewer
            </button>
            <button style={seg(viewRole === 'candidate')} onClick={() => onViewRole('candidate')} title="Preview what the candidate sees (UI only)">
              Candidate
            </button>
          </div>
        </div>
      )}

      <button
        className="pl-btn"
        onClick={onEnd}
        title={isRealInterviewer ? 'End session for everyone' : 'Leave the room'}
        style={{
          fontSize: 12,
          fontWeight: 600,
          color: T.redSoft,
          background: endState === 'idle' ? 'rgba(255,92,108,0.08)' : 'rgba(255,92,108,0.25)',
          border: '1px solid rgba(255,92,108,0.3)',
          padding: '8px 14px',
          borderRadius: 9,
          flexShrink: 0,
          whiteSpace: 'nowrap',
        }}
      >
        {isRealInterviewer ? endLabel : 'Leave'}
      </button>
    </header>
  );
}
