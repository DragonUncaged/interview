'use client';

import { useState } from 'react';
import { T } from '@/lib/theme';
import { errorHint } from '@/lib/errorMessages';
import type { CaseResult, TestCaseRow } from '@/lib/types';
import type { Studio } from './useStudio';

function CaseCard({
  n,
  input,
  out,
  passState,
  hidden,
  stderr,
}: {
  n: number;
  input: string;
  out: string;
  passState: 'idle' | 'pass' | 'fail';
  hidden: boolean;
  stderr?: string;
}) {
  const border =
    passState === 'pass'
      ? 'rgba(61,220,151,0.3)'
      : passState === 'fail'
        ? 'rgba(255,92,108,0.4)'
        : hidden
          ? 'rgba(255,212,121,0.18)'
          : 'rgba(255,255,255,0.06)';
  const dotBg = passState === 'pass' ? T.green : passState === 'fail' ? T.red : '#2a3444';
  const outColor = passState === 'pass' ? T.green : passState === 'fail' ? T.redSoft : T.textFaint;
  return (
    <div style={{ flex: 1, minWidth: 160, background: T.bg, border: `1px solid ${border}`, borderRadius: 9, padding: '11px 12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8 }}>
        <span
          style={{
            width: 14,
            height: 14,
            borderRadius: '50%',
            background: dotBg,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 9,
            color: passState === 'fail' ? '#fff' : T.greenDark,
          }}
        >
          {passState === 'pass' ? '✓' : passState === 'fail' ? '✕' : ''}
        </span>
        <span style={{ fontSize: 11, fontWeight: 600, color: T.textBody }}>Case {n}</span>
        {hidden && (
          <span
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 3,
              fontSize: 8.5,
              fontWeight: 700,
              letterSpacing: 0.5,
              color: T.yellow,
              background: 'rgba(255,212,121,0.12)',
              padding: '1px 6px',
              borderRadius: 20,
            }}
          >
            <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke={T.yellow} strokeWidth="2.5">
              <rect x="4" y="10" width="16" height="10" rx="2" />
              <path d="M8 10V7a4 4 0 018 0v3" />
            </svg>
            HIDDEN
          </span>
        )}
      </div>
      <div
        style={{
          fontFamily: T.fontMono,
          fontSize: 11,
          color: '#7d8799',
          lineHeight: 1.7,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
        title={input}
      >
        {input || '—'}
      </div>
      <div style={{ fontFamily: T.fontMono, fontSize: 11, lineHeight: 1.7, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={out}>
        <span style={{ color: T.textFaint }}>→ </span>
        <span style={{ color: outColor }}>{out || '—'}</span>
      </div>
      {stderr && passState === 'fail' && (
        <div style={{ fontFamily: T.fontMono, fontSize: 10, color: T.redSoft, marginTop: 6, whiteSpace: 'pre-wrap', maxHeight: 60, overflow: 'auto' }}>
          {stderr}
        </div>
      )}
    </div>
  );
}

export function TestDock({ studio, viewRole }: { studio: Studio; viewRole: 'interviewer' | 'candidate' }) {
  const [open, setOpen] = useState(true);
  const { run, testCases, hiddenCount } = studio;
  const isInterviewer = viewRole === 'interviewer';
  const hint = run.error ? errorHint(run.error, run.language ?? studio.session?.language ?? 'python') : null;

  // RLS already hides hidden rows from candidates; this filter is for interviewer preview.
  const visibleCases = testCases.filter((c) => !c.hidden);
  const hiddenCases = isInterviewer ? testCases.filter((c) => c.hidden) : [];

  const resultByPosition = new Map<number, CaseResult>();
  (run.visibleResults ?? []).forEach((r) => resultByPosition.set(r.position, r));
  (run.hiddenResults ?? []).forEach((r) => resultByPosition.set(r.position, r));

  const passState = (c: TestCaseRow): 'idle' | 'pass' | 'fail' => {
    if (run.state !== 'done' && run.state !== 'error') return 'idle';
    const r = resultByPosition.get(c.position);
    if (!r) return run.state === 'error' ? 'fail' : 'idle';
    return r.pass ? 'pass' : 'fail';
  };
  const gotFor = (c: TestCaseRow): string => {
    const r = resultByPosition.get(c.position);
    if (run.state === 'done' || run.state === 'error') {
      if (r && !r.pass && r.got) return `${r.got} (expected ${c.expected})`;
    }
    return c.expected;
  };

  const summary = run.summary;
  const totalShown = visibleCases.length + (isInterviewer ? hiddenCases.length : hiddenCount);
  const passedShown = summary ? summary.passed + summary.hiddenPassed : 0;
  const allPassed = summary && summary.passed === summary.total && summary.hiddenPassed === summary.hiddenTotal;

  const label =
    run.state === 'running'
      ? 'RUNNING…'
      : run.state === 'done' || run.state === 'error'
        ? summary
          ? `${passedShown} / ${totalShown} PASSED`
          : 'ERROR'
        : 'NOT RUN';
  const labelColor =
    run.state === 'running' ? T.yellow : run.state === 'idle' ? T.textFaint : allPassed && !run.error ? T.green : T.redSoft;
  const meta = summary && run.state !== 'running' ? `${summary.timeMs} ms` : '';

  return (
    <div style={{ flex: '0 0 auto', borderTop: `1px solid ${T.borderSoft}`, background: T.bgPanel }}>
      <button
        className="pl-btn"
        onClick={() => setOpen((o) => !o)}
        title="Collapse / expand testcases"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          width: '100%',
          padding: '9px 14px',
          background: 'transparent',
          border: 'none',
          textAlign: 'left',
        }}
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 14 14"
          fill="none"
          stroke="#7d8799"
          strokeWidth="2"
          style={{ transform: open ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform .15s ease' }}
        >
          <path d="M3 5l4 4 4-4" />
        </svg>
        <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: 1, color: '#7d8799' }}>TESTCASES</span>
        <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: 1, color: labelColor }}>{label}</span>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: T.textFaint, fontFamily: T.fontMono }}>{meta}</span>
      </button>
      {open && (
        <div style={{ padding: '0 14px 14px' }}>
          {run.error && (
            <div
              style={{
                background: 'rgba(255,92,108,0.06)',
                border: '1px solid rgba(255,92,108,0.25)',
                borderRadius: 8,
                padding: '10px 12px',
                marginBottom: 10,
              }}
            >
              <div
                style={{
                  fontFamily: T.fontMono,
                  fontSize: 11,
                  color: T.redSoft,
                  whiteSpace: 'pre-wrap',
                  maxHeight: 120,
                  overflow: 'auto',
                }}
              >
                {run.error}
              </div>
              {hint && (
                <div
                  style={{
                    fontSize: 11,
                    color: T.textMuted,
                    lineHeight: 1.4,
                    borderTop: '1px solid rgba(255,92,108,0.15)',
                    paddingTop: 8,
                    marginTop: 8,
                  }}
                >
                  💡 {hint}
                </div>
              )}
            </div>
          )}
          {run.state === 'running' && (
            <div
              style={{
                textAlign: 'center',
                padding: '16px 14px',
                color: T.yellow,
                fontSize: 12,
                lineHeight: 1.6,
                background: 'rgba(255,212,121,0.05)',
                border: '1px solid rgba(255,212,121,0.2)',
                borderRadius: 8,
                marginBottom: 10,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 6 }}>
                <span
                  style={{
                    width: 10,
                    height: 10,
                    border: '2px solid rgba(255,212,121,0.4)',
                    borderTopColor: T.yellow,
                    borderRadius: '50%',
                    animation: 'spin .8s linear infinite',
                    display: 'inline-block',
                  }}
                />
                <span style={{ fontWeight: 600 }}>Running your code...</span>
              </div>
              <div style={{ fontSize: 11, color: T.textFaint }}>Test cases will appear here when execution completes</div>
            </div>
          )}
          {totalShown === 0 && run.state !== 'running' && (
            <div
              style={{
                textAlign: 'center',
                padding: '20px 14px',
                color: T.textFaint,
                fontSize: 12,
                lineHeight: 1.6,
              }}
            >
              <div style={{ marginBottom: 6 }}>No test cases for this problem yet</div>
              <div style={{ fontSize: 11 }}>
                {isInterviewer ? 'Assign a problem from the Bank tab to add some.' : 'Your interviewer will add them.'}
              </div>
            </div>
          )}
          {totalShown > 0 && (
            <div style={{ display: 'flex', gap: 8, overflowX: 'auto' }}>
            {visibleCases.map((c, i) => (
              <CaseCard key={c.id} n={i + 1} input={c.input} out={gotFor(c)} passState={passState(c)} hidden={false}
                stderr={resultByPosition.get(c.position)?.stderr} />
            ))}
            {hiddenCases.map((c, i) => (
              <CaseCard key={c.id} n={visibleCases.length + i + 1} input={c.input} out={gotFor(c)} passState={passState(c)} hidden
                stderr={resultByPosition.get(c.position)?.stderr} />
            ))}
            {!isInterviewer && hiddenCount > 0 && (
              <div
                style={{
                  flex: 1,
                  minWidth: 160,
                  background: T.bg,
                  border: '1px dashed rgba(255,255,255,0.12)',
                  borderRadius: 9,
                  padding: '11px 12px',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'center',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 5 }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={T.textMuted} strokeWidth="2">
                    <rect x="4" y="10" width="16" height="10" rx="2" />
                    <path d="M8 10V7a4 4 0 018 0v3" />
                  </svg>
                  <span style={{ fontSize: 11, fontWeight: 600, color: T.textMuted }}>
                    {hiddenCount} hidden test{hiddenCount === 1 ? '' : 's'}
                    {summary && run.state !== 'running' && summary.hiddenTotal > 0 && (
                      <span style={{ color: summary.hiddenPassed === summary.hiddenTotal ? T.green : T.redSoft }}>
                        {' '}
                        · {summary.hiddenPassed}/{summary.hiddenTotal} passed
                      </span>
                    )}
                  </span>
                </div>
                <div style={{ fontSize: 11, color: T.textFaint, lineHeight: 1.4 }}>
                  Your solution is graded against these. Details are only visible to your interviewer.
                </div>
              </div>
            )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
