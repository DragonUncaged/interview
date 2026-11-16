'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Editor, type EditorHandle } from './Editor';
import { TestDock } from './TestDock';
import { LANGS, LANG_IDS, DEFAULT_STARTERS } from '@/lib/langs';
import { T } from '@/lib/theme';
import type { LangId } from '@/lib/types';
import type { Studio } from './useStudio';

export function CodePanel({
  studio,
  viewRole,
  onLnCol,
}: {
  studio: Studio;
  viewRole: 'interviewer' | 'candidate';
  onLnCol?: (line: number, col: number) => void;
}) {
  const { session, me } = studio;
  const editorRef = useRef<EditorHandle>(null);
  const [langMenuOpen, setLangMenuOpen] = useState(false);
  const [highlightMode, setHighlightMode] = useState(false);
  const [composerLine, setComposerLine] = useState<number | null>(null);

  const language = session!.language;
  const isInterviewer = viewRole === 'interviewer';
  const readOnly = studio.ended;

  // The editor's current language, in a ref so debounced saves never use a stale one.
  const langRef = useRef<LangId>(language);

  const initialDoc = useMemo(
    () => studio.getBuffer(language) ?? session!.code?.[language] ?? session!.starter_code?.[language] ?? DEFAULT_STARTERS[language],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  // Broadcast edits fast (120ms throttle), persist slowly (1.2s debounce).
  const broadcastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestText = useRef(initialDoc);

  const onChange = useCallback(
    (text: string) => {
      latestText.current = text;
      studio.setBuffer(langRef.current, text);
      studio.markDirty();
      if (!broadcastTimer.current) {
        broadcastTimer.current = setTimeout(() => {
          broadcastTimer.current = null;
          studio.broadcastCode(latestText.current);
        }, 120);
      }
      if (saveTimer.current) clearTimeout(saveTimer.current);
      const lang = langRef.current;
      saveTimer.current = setTimeout(() => {
        saveTimer.current = null;
        studio.saveCode(lang, latestText.current);
      }, 1200);
    },
    [studio]
  );

  // Flush pending work when the panel is toggled off. This must depend on the stable
  // callbacks, not on `studio`: that object is new every render, and a cleanup that runs
  // per render cancels every broadcast before it fires.
  const { saveCode, broadcastCode } = studio;
  useEffect(
    () => () => {
      if (broadcastTimer.current) {
        clearTimeout(broadcastTimer.current);
        broadcastTimer.current = null;
        broadcastCode(latestText.current);
      }
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
        saveCode(langRef.current, latestText.current);
      }
    },
    [saveCode, broadcastCode]
  );

  useEffect(
    () =>
      studio.subscribe((e) => {
        if (e.type === 'code') {
          latestText.current = e.text;
          studio.setBuffer(langRef.current, e.text);
          editorRef.current?.applyRemote(e.text);
        }
        if (e.type === 'lang') {
          // Someone else switched language: drop our pending save for the old one. Flushing
          // it would also set the session's language back, since pl_save_code records it.
          if (saveTimer.current) {
            clearTimeout(saveTimer.current);
            saveTimer.current = null;
            studio.markClean();
          }
          langRef.current = e.language;
          latestText.current = e.text;
          studio.setBuffer(e.language, e.text);
          editorRef.current?.setDoc(e.text, e.language);
        }
      }),
    // Depend on the stable callbacks only; `studio` changes on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [studio.subscribe, studio.setBuffer, studio.markClean]
  );

  const cursorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastCursor = useRef<{ line: number; col: number }>({ line: 1, col: 1 });
  const onCursor = useCallback(
    (line: number, col: number) => {
      lastCursor.current = { line, col };
      onLnCol?.(line, col);
      if (cursorTimer.current) return;
      cursorTimer.current = setTimeout(() => {
        cursorTimer.current = null;
        studio.broadcastCursor({
          area: 'editor',
          line: lastCursor.current.line,
          col: lastCursor.current.col,
        });
      }, 150);
    },
    [studio, onLnCol]
  );

  const onGutterClick = useCallback(
    (line: number) => {
      if (readOnly) return;
      if (isInterviewer && highlightMode) studio.toggleLinePin(line);
      else setComposerLine((c) => (c === line ? null : line));
    },
    [readOnly, isInterviewer, highlightMode, studio]
  );

  const onRangeSelect = useCallback(
    (line: number, colStart: number, colEnd: number) => {
      if (isInterviewer && highlightMode) studio.addRangePin(line, colStart, colEnd);
    },
    [isInterviewer, highlightMode, studio]
  );

  const onSubmitComment = useCallback(
    (line: number, text: string) => {
      studio.addComment(line, text);
      setComposerLine(null);
    },
    [studio]
  );

  async function switchLang(next: LangId) {
    setLangMenuOpen(false);
    if (next === langRef.current) return;
    const prev = langRef.current;
    // Cancel pending timers, then save the old buffer under the old language.
    if (broadcastTimer.current) {
      clearTimeout(broadcastTimer.current);
      broadcastTimer.current = null;
    }
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    const current = editorRef.current?.getText() ?? latestText.current;
    studio.setBuffer(prev, current);
    await studio.saveCode(prev, current);
    const text = studio.getBuffer(next) ?? session!.code?.[next] ?? session!.starter_code?.[next] ?? DEFAULT_STARTERS[next];
    langRef.current = next;
    latestText.current = text;
    studio.setBuffer(next, text);
    editorRef.current?.setDoc(text, next);
    await studio.setLanguage(next, text);
  }

  function runNow() {
    if (studio.run.state === 'running' || readOnly) return;
    studio.runCode(langRef.current, editorRef.current?.getText() ?? latestText.current);
  }

  const pinCount = studio.highlights.length;
  const interviewerFirstName =
    studio.participants.find((p) => p.role === 'interviewer')?.display_name.split(' ')[0] ?? 'Your interviewer';
  const running = studio.run.state === 'running';

  const editorRemoteCursors = useMemo(
    () => [...studio.remoteCursors.values()].filter((c) => c.area === 'editor'),
    [studio.remoteCursors]
  );

  return (
    <section
      style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, minWidth: 540, background: T.bg }}
    >
      <div
        style={{
          height: 44,
          flex: '0 0 44px',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '0 14px',
          borderBottom: `1px solid ${T.borderSoft}`,
          background: T.bgPanel,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={T.green} strokeWidth="2">
            <path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z" />
            <path d="M14 3v5h5" />
          </svg>
          <span style={{ fontFamily: T.fontMono, fontSize: 12.5, color: T.textSoft }}>{LANGS[language].file}</span>
        </div>

        <div style={{ position: 'relative' }}>
          <button
            className="pl-btn"
            onClick={() => setLangMenuOpen((o) => !o)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 7,
              fontFamily: T.fontMono,
              fontSize: 12,
              color: T.textBody,
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.08)',
              padding: '6px 10px',
              borderRadius: 7,
            }}
          >
            {LANGS[language].label}
            <svg width="10" height="10" viewBox="0 0 14 14" fill="none" stroke="#7d8799" strokeWidth="1.8">
              <path d="M3 5l4 4 4-4" />
            </svg>
          </button>
          {langMenuOpen && (
            <div
              style={{
                position: 'absolute',
                top: 38,
                left: 0,
                zIndex: 30,
                minWidth: 140,
                background: T.bgMenu,
                border: `1px solid ${T.borderInput}`,
                borderRadius: 9,
                padding: 5,
                boxShadow: '0 16px 40px rgba(0,0,0,0.55)',
              }}
            >
              {LANG_IDS.map((l) => (
                <button
                  key={l}
                  className="pl-btn"
                  onClick={() => switchLang(l)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    width: '100%',
                    textAlign: 'left',
                    fontFamily: T.fontMono,
                    fontSize: 12,
                    color: l === language ? T.green : T.textBody,
                    background: l === language ? 'rgba(61,220,151,0.08)' : 'transparent',
                    border: 'none',
                    padding: '7px 10px',
                    borderRadius: 6,
                  }}
                >
                  {LANGS[l].label} <span style={{ color: T.green }}>{l === language ? '✓' : ''}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {isInterviewer && !readOnly && (
          <button
            className="pl-btn"
            onClick={() => setHighlightMode((h) => !h)}
            title="Highlight a line number or select text to pin it for the candidate"
            style={
              highlightMode
                ? {
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    fontSize: 12,
                    fontWeight: 600,
                    color: '#2a1e00',
                    background: T.yellow,
                    border: 'none',
                    padding: '6px 11px',
                    borderRadius: 7,
                  }
                : {
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    fontSize: 12,
                    fontWeight: 500,
                    color: T.textBody,
                    background: 'rgba(255,255,255,0.04)',
                    border: '1px solid rgba(255,255,255,0.08)',
                    padding: '6px 11px',
                    borderRadius: 7,
                  }
            }
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4 20h16" />
              <path d="M7 15l7.5-7.5 3 3L10 18H7z" />
            </svg>
            Highlight
          </button>
        )}

        {!isInterviewer && pinCount > 0 && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 7,
              background: 'rgba(255,212,121,0.1)',
              border: '1px solid rgba(255,212,121,0.3)',
              padding: '5px 11px',
              borderRadius: 8,
            }}
          >
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: T.yellow, animation: 'pulse 1.6s ease-in-out infinite' }} />
            <span style={{ fontSize: 11.5, color: T.yellow, fontWeight: 600 }}>
              {interviewerFirstName} pinned {pinCount} spot{pinCount === 1 ? '' : 's'} for you
            </span>
          </div>
        )}

        <div style={{ flex: 1 }} />

        <button
          className="pl-btn"
          onClick={runNow}
          disabled={readOnly}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 7,
            fontSize: 12.5,
            fontWeight: 600,
            color: T.greenDark,
            background: T.green,
            padding: '8px 15px',
            borderRadius: 8,
            boxShadow: '0 0 16px rgba(61,220,151,0.3)',
          }}
        >
          {running ? (
            <span
              style={{
                width: 12,
                height: 12,
                border: '2px solid rgba(4,18,11,0.35)',
                borderTopColor: T.greenDark,
                borderRadius: '50%',
                animation: 'spin .7s linear infinite',
                display: 'inline-block',
              }}
            />
          ) : (
            <svg width="11" height="11" viewBox="0 0 12 12">
              <path d="M2 1.5L10.5 6L2 10.5Z" fill={T.greenDark} />
            </svg>
          )}
          {running ? 'Running' : 'Run'}
        </button>
      </div>

      <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
        <Editor
          ref={editorRef}
          initialDoc={initialDoc}
          language={language}
          readOnly={readOnly}
          meRole={me!.role}
          meName={me!.name}
          comments={studio.comments}
          highlights={studio.highlights}
          composerLine={composerLine}
          remoteCursors={editorRemoteCursors}
          highlightMode={highlightMode && isInterviewer}
          onChange={onChange}
          onCursor={onCursor}
          onGutterClick={onGutterClick}
          onRangeSelect={onRangeSelect}
          onSubmitComment={onSubmitComment}
          onCloseComposer={() => setComposerLine(null)}
        />
      </div>

      <TestDock studio={studio} viewRole={viewRole} />
    </section>
  );
}
