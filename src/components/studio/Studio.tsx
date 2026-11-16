'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useStudio } from './useStudio';
import { HeaderBar } from './HeaderBar';
import { LeftPanel } from './LeftPanel';
import { CodePanel } from './CodePanel';
import { Whiteboard } from './Whiteboard';
import { StatusBar } from './StatusBar';
import { T } from '@/lib/theme';

export function Studio({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const studio = useStudio(sessionId);
  const [viewRole, setViewRole] = useState<'interviewer' | 'candidate'>('interviewer');
  const [panels, setPanels] = useState({ problem: true, editor: true, whiteboard: true });
  const [lnCol, setLnCol] = useState({ line: 1, col: 1 });
  const viewRoleInit = useRef(false);

  // Set the preview role once; `me` changes again on problem reassignment.
  useEffect(() => {
    if (studio.me && !viewRoleInit.current) {
      viewRoleInit.current = true;
      setViewRole(studio.me.role);
    }
  }, [studio.me]);

  useEffect(() => {
    if (!studio.fatal) return;
    router.replace(`/join?error=${studio.fatal === 'not_authenticated' ? 'not_authenticated' : 'not_participant'}`);
  }, [studio.fatal, router]);

  if (studio.loading || !studio.session || !studio.me) {
    return (
      <div
        style={{
          height: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'column',
          gap: 16,
          background: T.bg,
          color: T.textMuted,
          fontFamily: T.fontUI,
        }}
      >
        <div
          style={{
            width: 22,
            height: 22,
            border: '3px solid rgba(61,220,151,0.2)',
            borderTopColor: T.green,
            borderRadius: '50%',
            animation: 'spin .8s linear infinite',
          }}
        />
        <span style={{ fontSize: 13 }}>Entering the room…</span>
      </div>
    );
  }

  // The real role gates data; viewRole only lets interviewers preview the candidate UI.
  const effectiveRole = studio.me.role === 'interviewer' ? viewRole : 'candidate';

  return (
    <div
      style={{
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        background: T.bg,
        color: T.text,
        fontFamily: T.fontUI,
        fontSize: 14,
        minWidth: 924,
      }}
    >
      <HeaderBar studio={studio} viewRole={effectiveRole} onViewRole={setViewRole} />

      <div style={{ flex: 1, display: 'flex', minHeight: 0, overflowX: 'auto', overflowY: 'hidden' }}>
        {panels.problem && <LeftPanel studio={studio} viewRole={effectiveRole} />}
        {panels.editor && <CodePanel studio={studio} viewRole={effectiveRole} onLnCol={(line, col) => setLnCol({ line, col })} />}
        {panels.whiteboard && <Whiteboard studio={studio} viewRole={effectiveRole} />}
      </div>

      <StatusBar
        studio={studio}
        lnCol={lnCol}
        panels={panels}
        onTogglePanel={(p) => setPanels((s) => ({ ...s, [p]: !s[p] }))}
      />

      {studio.ended && studio.me.role === 'candidate' && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(10,14,21,0.82)',
            backdropFilter: 'blur(3px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
          }}
        >
          <div
            style={{
              background: T.bgPanel,
              border: `1px solid ${T.border}`,
              borderRadius: 16,
              padding: 40,
              textAlign: 'center',
              maxWidth: 420,
            }}
          >
            <div style={{ fontSize: 34, marginBottom: 12 }}>🏁</div>
            <h2 style={{ margin: '0 0 8px', fontSize: 20, fontWeight: 600 }}>Interview ended</h2>
            <p style={{ margin: 0, fontSize: 13, color: T.textMuted, lineHeight: 1.6 }}>
              Thanks for pairing! Your interviewer has ended this session. You can close this tab now.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
