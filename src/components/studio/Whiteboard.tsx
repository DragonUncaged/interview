'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { T } from '@/lib/theme';
import type { WbObject, WbTool } from '@/lib/types';
import type { Studio } from './useStudio';

const TOOLS: { id: WbTool; title: string; icon: React.ReactNode }[] = [
  {
    id: 'pen',
    title: 'Pen',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M3 17.5L14 6.5l4 4L7 21.5H3z" />
        <path d="M13 7.5l4 4" />
      </svg>
    ),
  },
  {
    id: 'rect',
    title: 'Rectangle',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="4" y="6" width="16" height="12" rx="1.5" />
      </svg>
    ),
  },
  {
    id: 'circle',
    title: 'Ellipse',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="8" />
      </svg>
    ),
  },
  {
    id: 'arrow',
    title: 'Arrow',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M4 12h15M13 6l6 6-6 6" />
      </svg>
    ),
  },
  {
    id: 'text',
    title: 'Text',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M5 6h14M12 6v13" />
      </svg>
    ),
  },
  {
    id: 'sticky',
    title: 'Sticky note',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M4 4h16v11l-5 5H4z" />
        <path d="M20 15h-5v5" />
      </svg>
    ),
  },
];

const canvasFamilies = new Map<string, string>();

/** Canvas text can't use CSS variables, so look up the family next/font registered. */
function canvasFont(canvas: HTMLCanvasElement, cssVar: string, generic: string): string {
  let family = canvasFamilies.get(cssVar);
  if (family === undefined) {
    family = getComputedStyle(canvas).getPropertyValue(cssVar).trim();
    if (family) canvasFamilies.set(cssVar, family);
  }
  return family ? `${family}, ${generic}` : generic;
}

function drawObject(ctx: CanvasRenderingContext2D, o: WbObject) {
  ctx.strokeStyle = o.color;
  ctx.fillStyle = o.color;
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  switch (o.kind) {
    case 'stroke': {
      const pts = o.points ?? [];
      if (pts.length < 2) return;
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (const [x, y] of pts.slice(1)) ctx.lineTo(x, y);
      ctx.stroke();
      break;
    }
    case 'rect':
      ctx.strokeRect(o.x!, o.y!, o.w!, o.h!);
      break;
    case 'circle':
      ctx.beginPath();
      ctx.ellipse(o.x! + o.w! / 2, o.y! + o.h! / 2, Math.abs(o.w! / 2), Math.abs(o.h! / 2), 0, 0, Math.PI * 2);
      ctx.stroke();
      break;
    case 'arrow': {
      const x1 = o.x!,
        y1 = o.y!,
        x2 = o.x! + o.w!,
        y2 = o.y! + o.h!;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      const angle = Math.atan2(y2 - y1, x2 - x1);
      const size = 9;
      ctx.beginPath();
      ctx.moveTo(x2, y2);
      ctx.lineTo(x2 - size * Math.cos(angle - Math.PI / 6), y2 - size * Math.sin(angle - Math.PI / 6));
      ctx.moveTo(x2, y2);
      ctx.lineTo(x2 - size * Math.cos(angle + Math.PI / 6), y2 - size * Math.sin(angle + Math.PI / 6));
      ctx.stroke();
      break;
    }
    case 'text':
      ctx.font = `20px ${canvasFont(ctx.canvas, '--font-hand', 'cursive')}`;
      ctx.textBaseline = 'top';
      (o.text ?? '').split('\n').forEach((line, i) => ctx.fillText(line, o.x!, o.y! + i * 24));
      break;
    case 'sticky': {
      const w = Math.max(o.w ?? 120, 60);
      const lines = (o.text ?? '').split('\n');
      const h = Math.max(40, 16 + lines.length * 18);
      ctx.fillStyle = 'rgba(255,212,121,0.14)';
      ctx.fillRect(o.x!, o.y!, w, h);
      ctx.strokeStyle = 'rgba(255,212,121,0.5)';
      ctx.strokeRect(o.x!, o.y!, w, h);
      ctx.fillStyle = T.yellow;
      ctx.font = `13px ${canvasFont(ctx.canvas, '--font-ui', 'sans-serif')}`;
      ctx.textBaseline = 'top';
      lines.forEach((line, i) => ctx.fillText(line, o.x! + 8, o.y! + 8 + i * 18, w - 16));
      break;
    }
  }
}

function hitTest(o: WbObject, x: number, y: number): boolean {
  const pad = 8;
  if (o.kind === 'stroke') return (o.points ?? []).some(([px, py]) => Math.hypot(px - x, py - y) < pad + 4);
  const bx = Math.min(o.x!, o.x! + (o.w ?? 0)) - pad;
  const by = Math.min(o.y!, o.y! + (o.h ?? 0)) - pad;
  const bw = Math.abs(o.w ?? (o.kind === 'text' ? 120 : 0)) + pad * 2;
  const bh = Math.abs(o.h ?? (o.kind === 'text' ? 24 : o.kind === 'sticky' ? 60 : 0)) + pad * 2;
  return x >= bx && x <= bx + bw && y >= by && y <= by + bh;
}

export function Whiteboard({ studio, viewRole }: { studio: Studio; viewRole: 'interviewer' | 'candidate' }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const objectsRef = useRef<Map<string, WbObject>>(new Map());
  const previewsRef = useRef<Map<string, WbObject>>(new Map()); // authorId -> shape being drawn
  const draftRef = useRef<WbObject | null>(null);
  const [tool, setTool] = useState<WbTool>('pen');
  const [textEntry, setTextEntry] = useState<{ x: number; y: number; kind: 'text' | 'sticky' } | null>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const isInterviewer = viewRole === 'interviewer';
  const readOnly = studio.ended;

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
    for (const o of objectsRef.current.values()) drawObject(ctx, o);
    for (const o of previewsRef.current.values()) drawObject(ctx, o);
    if (draftRef.current) drawObject(ctx, draftRef.current);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ro = new ResizeObserver(() => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = wrap.clientWidth * dpr;
      canvas.height = wrap.clientHeight * dpr;
      canvas.style.width = `${wrap.clientWidth}px`;
      canvas.style.height = `${wrap.clientHeight}px`;
      redraw();
    });
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [redraw]);

  useEffect(() => {
    let alive = true;
    studio.loadWhiteboard().then((objs) => {
      if (!alive) return;
      objectsRef.current = new Map(objs.map((o) => [o.id, o]));
      redraw();
    });
    const off = studio.subscribe((e) => {
      if (e.type === 'wb-add') {
        objectsRef.current.set(e.obj.id, e.obj);
        previewsRef.current.delete(e.obj.authorId);
        redraw();
      }
      if (e.type === 'wb-erase') {
        for (const id of e.ids) objectsRef.current.delete(id);
        redraw();
      }
      if (e.type === 'wb-preview') {
        if (e.obj) previewsRef.current.set(e.authorId, e.obj);
        else previewsRef.current.delete(e.authorId);
        redraw();
      }
    });
    return () => {
      alive = false;
      off();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studio.sessionId]);

  const drawing = useRef(false);
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cursorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Unmounting mid-stroke: clear our preview on peers so it doesn't linger. Depends on the
  // stable callback, not on `studio`, which is a new object every render.
  const { wbPreview } = studio;
  useEffect(
    () => () => {
      if (previewTimer.current) clearTimeout(previewTimer.current);
      if (cursorTimer.current) clearTimeout(cursorTimer.current);
      previewTimer.current = null;
      cursorTimer.current = null;
      if (draftRef.current) wbPreview(null);
    },
    [wbPreview]
  );

  const pos = (e: React.PointerEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const throttledPreview = useCallback(() => {
    if (previewTimer.current) return;
    previewTimer.current = setTimeout(() => {
      previewTimer.current = null;
      if (draftRef.current) studio.wbPreview(draftRef.current);
    }, 90);
  }, [studio]);

  function onPointerDown(e: React.PointerEvent) {
    if (readOnly) return;
    const { x, y } = pos(e);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);

    if (tool === 'eraser') {
      const hit = [...objectsRef.current.values()].filter((o) => hitTest(o, x, y)).map((o) => o.id);
      if (hit.length) {
        for (const id of hit) objectsRef.current.delete(id);
        studio.wbErase(hit);
        redraw();
      }
      drawing.current = true;
      return;
    }
    if (tool === 'text' || tool === 'sticky') {
      setTextEntry({ x, y, kind: tool });
      setTimeout(() => textRef.current?.focus(), 30);
      return;
    }
    drawing.current = true;
    const id = crypto.randomUUID();
    const color = studio.me?.color ?? T.green;
    if (tool === 'pen') {
      draftRef.current = { id, kind: 'stroke', color, authorId: studio.me!.userId, points: [[x, y]] };
    } else {
      draftRef.current = {
        id,
        kind: tool === 'rect' ? 'rect' : tool === 'circle' ? 'circle' : 'arrow',
        color,
        authorId: studio.me!.userId,
        x,
        y,
        w: 0,
        h: 0,
      };
    }
  }

  function onPointerMove(e: React.PointerEvent) {
    const { x, y } = pos(e);

    if (!cursorTimer.current) {
      cursorTimer.current = setTimeout(() => {
        cursorTimer.current = null;
      }, 80);
      studio.broadcastCursor({ area: 'board', x, y });
    }

    if (!drawing.current) return;
    if (tool === 'eraser') {
      const hit = [...objectsRef.current.values()].filter((o) => hitTest(o, x, y)).map((o) => o.id);
      if (hit.length) {
        for (const id of hit) objectsRef.current.delete(id);
        studio.wbErase(hit);
        redraw();
      }
      return;
    }
    const d = draftRef.current;
    if (!d) return;
    if (d.kind === 'stroke') {
      const last = d.points![d.points!.length - 1];
      if (Math.hypot(x - last[0], y - last[1]) > 2) d.points!.push([x, y]);
    } else {
      d.w = x - d.x!;
      d.h = y - d.y!;
    }
    throttledPreview();
    redraw();
  }

  function onPointerUp() {
    if (tool === 'eraser') {
      drawing.current = false;
      return;
    }
    if (!drawing.current || !draftRef.current) return;
    drawing.current = false;
    const d = draftRef.current;
    draftRef.current = null;
    const tooSmall =
      (d.kind === 'stroke' && (d.points?.length ?? 0) < 2) ||
      (d.kind !== 'stroke' && Math.abs(d.w ?? 0) < 4 && Math.abs(d.h ?? 0) < 4);
    studio.wbPreview(null);
    if (tooSmall) {
      redraw();
      return;
    }
    objectsRef.current.set(d.id, d);
    studio.wbAdd(d);
    redraw();
  }

  function commitText() {
    if (!textEntry) return;
    const value = textRef.current?.value ?? '';
    setTextEntry(null);
    if (!value.trim()) return;
    const obj: WbObject = {
      id: crypto.randomUUID(),
      kind: textEntry.kind,
      color: textEntry.kind === 'sticky' ? T.yellow : (studio.me?.color ?? T.green),
      authorId: studio.me!.userId,
      x: textEntry.x,
      y: textEntry.y,
      w: textEntry.kind === 'sticky' ? 150 : undefined,
      text: value.trimEnd(),
    };
    objectsRef.current.set(obj.id, obj);
    studio.wbAdd(obj);
    redraw();
  }

  const candidateFirst = studio.participants.find((p) => p.role === 'candidate')?.display_name.split(' ')[0] ?? 'Candidate';
  const boardCursors = [...studio.remoteCursors.values()].filter((c) => c.area === 'board');

  const toolStyle = (active: boolean): React.CSSProperties => ({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 32,
    height: 32,
    color: active ? T.greenDark : T.textMuted,
    background: active ? T.green : 'transparent',
    border: 'none',
    borderRadius: 8,
    cursor: 'pointer',
  });

  return (
    <section
      style={{
        width: 420,
        flex: '0 0 420px',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        background: T.bgPanel,
        borderLeft: `1px solid ${T.borderSoft}`,
      }}
    >
      <div
        style={{
          height: 44,
          flex: '0 0 44px',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '0 14px',
          borderBottom: `1px solid ${T.borderSoft}`,
        }}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={T.green} strokeWidth="2">
          <rect x="3" y="4" width="18" height="13" rx="2" />
          <path d="M9 21h6M12 17v4" />
        </svg>
        <span style={{ fontSize: 12.5, fontWeight: 600, color: T.textSoft }}>
          {isInterviewer ? `${candidateFirst}'s whiteboard` : 'Whiteboard'}
        </span>
        <div style={{ flex: 1 }} />
        <span
          style={{
            fontSize: 10,
            color: isInterviewer ? T.blueSoft : T.green,
            background: isInterviewer ? 'rgba(91,140,255,0.1)' : 'rgba(61,220,151,0.1)',
            border: `1px solid ${isInterviewer ? 'rgba(91,140,255,0.3)' : 'rgba(61,220,151,0.3)'}`,
            padding: '2px 8px',
            borderRadius: 20,
            fontWeight: 600,
          }}
        >
          {isInterviewer ? 'FOLLOWING' : 'SHARED'}
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '8px 12px', borderBottom: `1px solid ${T.borderSoft}` }}>
        {TOOLS.map((tl) => (
          <button key={tl.id} title={tl.title} style={toolStyle(tool === tl.id)} onClick={() => setTool(tl.id)}>
            {tl.icon}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <button title="Eraser" style={toolStyle(tool === 'eraser')} onClick={() => setTool('eraser')}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M4 15l7-7 6 6-4 4H8z" />
            <path d="M9 20h11" />
          </svg>
        </button>
      </div>

      <div
        ref={wrapRef}
        style={{
          flex: 1,
          position: 'relative',
          overflow: 'hidden',
          backgroundColor: T.bg,
          backgroundImage: 'radial-gradient(rgba(255,255,255,0.05) 1px, transparent 1px)',
          backgroundSize: '22px 22px',
          cursor: readOnly ? 'default' : tool === 'eraser' ? 'cell' : 'crosshair',
          touchAction: 'none',
        }}
      >
        <canvas
          ref={canvasRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
          style={{ position: 'absolute', inset: 0 }}
        />
        {textEntry && (
          <textarea
            ref={textRef}
            onBlur={commitText}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                commitText();
              }
              if (e.key === 'Escape') setTextEntry(null);
            }}
            placeholder={textEntry.kind === 'sticky' ? 'Sticky note…' : 'Type, Enter to place'}
            style={{
              position: 'absolute',
              left: textEntry.x,
              top: textEntry.y,
              width: 170,
              height: 54,
              background: textEntry.kind === 'sticky' ? 'rgba(255,212,121,0.12)' : 'rgba(10,14,21,0.85)',
              border: `1px dashed ${textEntry.kind === 'sticky' ? T.yellow : T.green}`,
              borderRadius: 6,
              color: textEntry.kind === 'sticky' ? T.yellow : T.text,
              fontFamily: textEntry.kind === 'sticky' ? T.fontUI : T.fontHand,
              fontSize: textEntry.kind === 'sticky' ? 13 : 18,
              padding: 6,
              outline: 'none',
              resize: 'none',
              zIndex: 5,
            }}
          />
        )}
        {boardCursors.map((c) => (
          <div key={c.userId} style={{ position: 'absolute', left: c.x ?? 0, top: c.y ?? 0, pointerEvents: 'none', zIndex: 4, transition: 'left .08s linear, top .08s linear' }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill={c.color} style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.5))' }}>
              <path d="M4 2l6 16 2.5-6.5L19 9z" />
            </svg>
            <span
              style={{
                position: 'absolute',
                left: 16,
                top: 16,
                whiteSpace: 'nowrap',
                background: c.color,
                color: T.greenDark,
                fontSize: 10,
                fontWeight: 600,
                padding: '1px 6px',
                borderRadius: '5px 5px 5px 0',
              }}
            >
              {c.name.split(' ')[0]}
            </span>
          </div>
        ))}
      </div>

      <div style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 8, padding: '9px 14px', borderTop: `1px solid ${T.borderSoft}` }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: T.green, animation: 'pulse 2s ease-in-out infinite' }} />
        <span style={{ fontSize: 11, color: '#7d8799' }}>
          {isInterviewer ? `Shared board — everyone sees changes live` : `Your interviewer can see this board`}
        </span>
      </div>
    </section>
  );
}
