'use client';

import { T } from '@/lib/theme';
import { LANGS } from '@/lib/langs';
import type { Studio } from './useStudio';

export function StatusBar({
  studio,
  lnCol,
  panels,
  onTogglePanel,
}: {
  studio: Studio;
  lnCol: { line: number; col: number };
  panels: { problem: boolean; editor: boolean; whiteboard: boolean };
  onTogglePanel: (p: 'problem' | 'editor' | 'whiteboard') => void;
}) {
  const other = studio.participants.find((p) => p.user_id !== studio.me?.userId);
  const otherOnline = other && studio.onlineIds.has(other.user_id);
  const presenceLabel = studio.typingName
    ? `${studio.typingName.split(' ')[0]} is typing…`
    : other && otherOnline
      ? `${other.display_name.split(' ')[0]} is watching`
      : other
        ? `${other.display_name.split(' ')[0]} is offline`
        : 'Waiting for others…';

  const toggle = (active: boolean): React.CSSProperties => ({
    display: 'flex',
    alignItems: 'center',
    fontFamily: 'inherit',
    fontSize: 11,
    fontWeight: active ? 600 : 500,
    color: active ? T.green : '#6b7688',
    background: active ? 'rgba(61,220,151,0.14)' : 'transparent',
    border: 'none',
    padding: '3px 9px',
    borderRadius: 5,
    cursor: 'pointer',
  });

  return (
    <footer
      style={{
        height: 30,
        flex: '0 0 30px',
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        padding: '0 16px',
        background: '#0d1220',
        borderTop: `1px solid ${T.border}`,
        fontSize: 11,
        color: T.textFaint,
        fontFamily: T.fontMono,
      }}
    >
      <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: studio.connected ? T.green : T.yellow }}>
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: studio.connected ? T.green : T.yellow,
            boxShadow: studio.connected ? '0 0 6px rgba(61,220,151,0.7)' : 'none',
          }}
        />
        {studio.connected ? 'Live · synced' : 'Connecting…'}
      </span>
      <span>main</span>
      <span>UTF-8</span>
      <span>{LANGS[studio.session?.language ?? 'python'].statusLabel}</span>
      <div style={{ flex: 1 }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
        <span style={{ color: '#4a5468', marginRight: 5, letterSpacing: 0.5 }}>PANELS</span>
        <button style={toggle(panels.problem)} onClick={() => onTogglePanel('problem')} title="Toggle problem panel">
          Problem
        </button>
        <button style={toggle(panels.editor)} onClick={() => onTogglePanel('editor')} title="Toggle code editor">
          Editor
        </button>
        <button style={toggle(panels.whiteboard)} onClick={() => onTogglePanel('whiteboard')} title="Toggle whiteboard">
          Whiteboard
        </button>
      </div>
      <div style={{ width: 1, height: 16, background: 'rgba(255,255,255,0.1)' }} />
      <span>{presenceLabel}</span>
      <span>
        Ln {lnCol.line}, Col {lnCol.col}
      </span>
      <span>Spaces: 4</span>
    </footer>
  );
}
