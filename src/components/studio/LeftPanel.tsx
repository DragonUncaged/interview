'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { T, ROLE_COLORS, initials, diffMeta } from '@/lib/theme';
import { PROBLEM_COLUMNS, RUBRIC_CRITERIA, type Problem } from '@/lib/types';
import type { Studio } from './useStudio';

type Tab = 'problem' | 'rubric' | 'bank' | 'notes';

// Minimal renderer for problem text: **bold**, `code`, examples and constraint lists.
function renderInline(text: string, keyPrefix: string) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((p, i) => {
    if (p.startsWith('**') && p.endsWith('**'))
      return (
        <strong key={`${keyPrefix}-${i}`} style={{ color: T.textSoft }}>
          {p.slice(2, -2)}
        </strong>
      );
    if (p.startsWith('`') && p.endsWith('`'))
      return (
        <code
          key={`${keyPrefix}-${i}`}
          style={{
            fontFamily: T.fontMono,
            fontSize: 12,
            color: T.code.ty,
            background: 'rgba(127,219,202,0.08)',
            padding: '1px 5px',
            borderRadius: 4,
          }}
        >
          {p.slice(1, -1)}
        </code>
      );
    return <span key={`${keyPrefix}-${i}`}>{p}</span>;
  });
}

function Description({ text }: { text: string }) {
  const blocks = text.split(/\n\n+/);
  return (
    <>
      {blocks.map((block, bi) => {
        const lines = block.split('\n');
        const isExample = /^(\*\*)?(Example|Input:)/i.test(block.trim()) || lines.some((l) => /^(Input|Output):/i.test(l.trim()));
        const isConstraints = /^(\*\*)?Constraints/i.test(block.trim()) || lines.every((l) => l.trim().startsWith('-'));
        if (isExample) {
          const title = lines[0].startsWith('**') ? lines[0].replace(/\*\*/g, '') : null;
          const body = title ? lines.slice(1) : lines;
          return (
            <div key={bi} style={{ marginBottom: 14 }}>
              {title && (
                <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: 1, color: T.textFaint, marginBottom: 9, textTransform: 'uppercase' }}>
                  {title}
                </div>
              )}
              <div
                style={{
                  background: T.bg,
                  border: `1px solid ${T.borderSoft}`,
                  borderLeft: `2px solid ${T.green}`,
                  borderRadius: 8,
                  padding: '12px 14px',
                  fontFamily: T.fontMono,
                  fontSize: 12,
                  lineHeight: 1.9,
                }}
              >
                {body.map((l, li) => {
                  const m = l.match(/^(Input|Output):\s*(.*)$/i);
                  if (m)
                    return (
                      <div key={li}>
                        <span style={{ color: T.textFaint }}>{m[1]}: </span>
                        <span style={{ color: m[1].toLowerCase() === 'output' ? T.green : T.code.txt }}>{m[2]}</span>
                      </div>
                    );
                  return (
                    <div key={li} style={{ color: T.textFaint, fontSize: 11 }}>
                      {l}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        }
        if (isConstraints && lines.some((l) => l.trim().startsWith('-'))) {
          const title = lines[0].startsWith('**') ? lines[0].replace(/\*\*/g, '') : null;
          const items = lines.filter((l) => l.trim().startsWith('-'));
          return (
            <div key={bi} style={{ marginBottom: 18 }}>
              {title && (
                <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: 1, color: T.textFaint, marginBottom: 10, textTransform: 'uppercase' }}>
                  {title}
                </div>
              )}
              <ul style={{ margin: 0, paddingLeft: 18, color: T.textMuted, fontSize: 12.5, lineHeight: 1.9, fontFamily: T.fontMono }}>
                {items.map((l, li) => (
                  <li key={li}>{l.replace(/^-\s*/, '')}</li>
                ))}
              </ul>
            </div>
          );
        }
        return (
          <p key={bi} style={{ margin: '0 0 16px', lineHeight: 1.65, color: T.textBody, fontSize: 13.5 }}>
            {renderInline(block, `b${bi}`)}
          </p>
        );
      })}
    </>
  );
}

export function LeftPanel({ studio, viewRole }: { studio: Studio; viewRole: 'interviewer' | 'candidate' }) {
  const { session, me, supabase, sessionId } = studio;
  const isInterviewer = viewRole === 'interviewer';
  const [tab, setTab] = useState<Tab>('problem');

  useEffect(() => {
    if (!isInterviewer && (tab === 'rubric' || tab === 'bank')) setTab('problem');
    if (isInterviewer && tab === 'notes') setTab('problem');
  }, [isInterviewer, tab]);

  const [scores, setScores] = useState<Record<string, number>>({});
  const [intNotes, setIntNotes] = useState('');
  const intNotesTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (me?.role !== 'interviewer') return;
    (async () => {
      const { data: sc } = await supabase
        .from('pl_rubric_scores')
        .select('criterion,score')
        .eq('session_id', sessionId)
        .eq('interviewer_id', me.userId);
      const map: Record<string, number> = {};
      for (const r of (sc as { criterion: string; score: number }[]) ?? []) map[r.criterion] = r.score;
      setScores(map);
      const { data: n } = await supabase
        .from('pl_interviewer_notes')
        .select('body')
        .eq('session_id', sessionId)
        .eq('interviewer_id', me.userId)
        .maybeSingle();
      if (n) setIntNotes(n.body);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.role]);

  async function setScore(criterion: string, score: number) {
    if (!me) return;
    setScores((s) => ({ ...s, [criterion]: score }));
    await supabase
      .from('pl_rubric_scores')
      .upsert(
        { session_id: sessionId, interviewer_id: me.userId, criterion, score, updated_at: new Date().toISOString() },
        { onConflict: 'session_id,interviewer_id,criterion' }
      );
  }

  function saveIntNotes(body: string) {
    setIntNotes(body);
    if (intNotesTimer.current) clearTimeout(intNotesTimer.current);
    intNotesTimer.current = setTimeout(async () => {
      if (!me) return;
      await supabase
        .from('pl_interviewer_notes')
        .upsert(
          { session_id: sessionId, interviewer_id: me.userId, body, updated_at: new Date().toISOString() },
          { onConflict: 'session_id,interviewer_id' }
        );
    }, 800);
  }

  const [candNotes, setCandNotes] = useState('');
  const candNotesTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (me?.role !== 'candidate') return;
    supabase
      .from('pl_candidate_notes')
      .select('body')
      .eq('session_id', sessionId)
      .eq('user_id', me.userId)
      .maybeSingle()
      .then(({ data }) => {
        if (data) setCandNotes(data.body);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.role]);

  function saveCandNotes(body: string) {
    setCandNotes(body);
    // An interviewer previewing the candidate view must not write.
    if (me?.role !== 'candidate') return;
    if (candNotesTimer.current) clearTimeout(candNotesTimer.current);
    candNotesTimer.current = setTimeout(async () => {
      if (!me) return;
      await supabase
        .from('pl_candidate_notes')
        .upsert(
          { session_id: sessionId, user_id: me.userId, body, updated_at: new Date().toISOString() },
          { onConflict: 'session_id,user_id' }
        );
    }, 800);
  }

  const [bank, setBank] = useState<Problem[]>([]);
  const [bankQuery, setBankQuery] = useState('');
  const [assigning, setAssigning] = useState<string | null>(null);
  const [assignError, setAssignError] = useState<string | null>(null);
  const [hintError, setHintError] = useState<string | null>(null);
  useEffect(() => {
    if (me?.role !== 'interviewer') return;
    supabase
      .from('pl_problems')
      .select(PROBLEM_COLUMNS)
      .order('number')
      .then(({ data }) => setBank((data as Problem[]) ?? []));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.role]);

  async function assign(problemId: string) {
    setAssigning(problemId);
    setAssignError(null);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ problemId }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setAssignError(typeof json.error === 'string' ? json.error : 'Could not assign this problem');
      }
    } catch {
      setAssignError('Network error. Try again.');
    } finally {
      setAssigning(null);
    }
  }

  async function reveal(index: number) {
    setHintError(null);
    const code = await studio.revealHint(index);
    if (code) setHintError(code.includes('session_completed') ? 'The interview has ended.' : 'Could not reveal that hint. Try again.');
  }

  const filteredBank = useMemo(
    () =>
      bank.filter(
        (p) =>
          !bankQuery ||
          p.title.toLowerCase().includes(bankQuery.toLowerCase()) ||
          p.tags.join(' ').toLowerCase().includes(bankQuery.toLowerCase())
      ),
    [bank, bankQuery]
  );

  const hints = studio.hints;
  const revealedCount = hints.filter((h) => h.revealed).length;
  const dm = diffMeta(session?.difficulty ?? 'easy');
  const candidate = studio.participants.find((p) => p.role === 'candidate');

  const tabStyle = (active: boolean): React.CSSProperties => ({
    fontFamily: 'inherit',
    fontSize: 12.5,
    fontWeight: active ? 600 : 500,
    color: active ? T.text : '#6b7688',
    background: 'transparent',
    border: 'none',
    borderBottom: `2px solid ${active ? T.green : 'transparent'}`,
    padding: '0 12px',
    cursor: 'pointer',
  });

  return (
    <section
      style={{
        width: 352,
        flex: '0 0 352px',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        background: T.bgCard,
        borderRight: `1px solid ${T.borderSoft}`,
      }}
    >
      <div
        style={{
          height: 44,
          flex: '0 0 44px',
          display: 'flex',
          alignItems: 'stretch',
          gap: 2,
          padding: '0 10px',
          borderBottom: `1px solid ${T.borderSoft}`,
        }}
      >
        <button style={tabStyle(tab === 'problem')} onClick={() => setTab('problem')}>
          Problem
        </button>
        {isInterviewer && (
          <>
            <button style={tabStyle(tab === 'rubric')} onClick={() => setTab('rubric')}>
              Rubric
            </button>
            <button style={tabStyle(tab === 'bank')} onClick={() => setTab('bank')}>
              Bank
            </button>
          </>
        )}
        {!isInterviewer && (
          <button style={tabStyle(tab === 'notes')} onClick={() => setTab('notes')}>
            My notes
          </button>
        )}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {tab === 'problem' && session && (
          <div style={{ padding: '20px 20px 40px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  letterSpacing: 0.5,
                  color: dm.color,
                  background: dm.bg,
                  border: `1px solid ${dm.border}`,
                  padding: '2px 9px',
                  borderRadius: 20,
                }}
              >
                {session.difficulty.toUpperCase()}
              </span>
              {session.tags.map((tag, i) => (
                <span key={tag} style={{ fontSize: 11, color: T.textFaint, fontFamily: T.fontMono }}>
                  {i > 0 ? '· ' : ''}
                  {tag}
                </span>
              ))}
            </div>
            <h1 style={{ margin: '0 0 14px', fontSize: 21, fontWeight: 600, letterSpacing: -0.2 }}>
              {session.problem_number ? `${session.problem_number}. ` : ''}
              {session.problem_title}
            </h1>
            <Description text={session.description} />
            {session.follow_up && (
              <div style={{ background: 'rgba(91,140,255,0.06)', border: '1px solid rgba(91,140,255,0.2)', borderRadius: 8, padding: '12px 14px', marginTop: 8 }}>
                <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: 1, color: T.blueSoft, marginBottom: 5 }}>FOLLOW-UP</div>
                <div style={{ fontSize: 12.5, color: T.textBody, lineHeight: 1.5 }}>{session.follow_up}</div>
              </div>
            )}
          </div>
        )}

        {tab === 'rubric' && isInterviewer && (
          <div style={{ padding: '20px 20px 40px' }}>
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: 1, color: T.textFaint, marginBottom: 4 }}>EVALUATING</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 22 }}>
              <div
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: '50%',
                  background: ROLE_COLORS.candidate.avBg,
                  border: `2px solid ${T.blue}`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 11,
                  fontWeight: 600,
                  color: T.blueSoft,
                }}
              >
                {initials(candidate?.display_name ?? session?.candidate_name ?? '')}
              </div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{candidate?.display_name ?? session?.candidate_name}</div>
                <div style={{ fontSize: 11, color: T.textFaint }}>{session?.candidate_role_label}</div>
              </div>
            </div>

            {RUBRIC_CRITERIA.map((label) => {
              const score = scores[label] ?? 0;
              return (
                <div key={label} style={{ marginBottom: 18 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 7 }}>
                    <span style={{ fontSize: 13, color: T.textSoft }}>{label}</span>
                    <span style={{ fontSize: 11, fontFamily: T.fontMono, color: '#7d8799' }}>{score} / 4</span>
                  </div>
                  <div style={{ display: 'flex', gap: 5 }}>
                    {[1, 2, 3, 4].map((i) => (
                      <button
                        key={i}
                        title={`${label}: ${i}/4`}
                        onClick={() => setScore(label, score === i ? i - 1 : i)}
                        style={{
                          height: 8,
                          flex: 1,
                          borderRadius: 3,
                          border: 'none',
                          cursor: 'pointer',
                          background: i <= score ? T.green : 'rgba(255,255,255,0.09)',
                          padding: 0,
                        }}
                      />
                    ))}
                  </div>
                </div>
              );
            })}

            {hints.length > 0 && (
              <div
                style={{ fontSize: 11.5, color: revealedCount ? T.yellow : T.textFaint, margin: '18px 0 0' }}
              >
                {revealedCount
                  ? `⚠ Candidate revealed ${revealedCount} of ${hints.length} hint${hints.length === 1 ? '' : 's'}`
                  : `No hints revealed yet (${hints.length} available)`}
              </div>
            )}

            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: 1, color: T.textFaint, margin: '24px 0 9px' }}>PRIVATE NOTES</div>
            <textarea
              value={intNotes}
              onChange={(e) => saveIntNotes(e.target.value)}
              placeholder="Only interviewers on this session can see these notes."
              style={{
                width: '100%',
                height: 130,
                resize: 'none',
                background: T.bg,
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 8,
                padding: '11px 12px',
                color: T.textSoft,
                fontSize: 12.5,
                lineHeight: 1.6,
                outline: 'none',
              }}
            />
          </div>
        )}

        {tab === 'bank' && isInterviewer && (
          <div style={{ padding: '16px 16px 40px' }}>
            <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
              <div
                style={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  background: T.bg,
                  border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: 8,
                  padding: '8px 11px',
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={T.textFaint} strokeWidth="2">
                  <circle cx="11" cy="11" r="7" />
                  <path d="M20 20l-3.5-3.5" />
                </svg>
                <input
                  value={bankQuery}
                  onChange={(e) => setBankQuery(e.target.value)}
                  placeholder="Search problems…"
                  style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: T.textSoft, fontSize: 12.5, fontFamily: 'inherit' }}
                />
              </div>
            </div>
            {assignError && (
              <div role="alert" style={{ fontSize: 12, color: T.redSoft, margin: '-4px 2px 12px' }}>
                {assignError}
              </div>
            )}
            {filteredBank.map((q) => {
              const qdm = diffMeta(q.difficulty);
              const assigned = session?.problem_id === q.id;
              return (
                <div
                  key={q.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: 12,
                    border: `1px solid ${T.borderSoft}`,
                    borderRadius: 9,
                    marginBottom: 8,
                    background: assigned ? 'rgba(61,220,151,0.05)' : 'transparent',
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, color: T.textSoft, marginBottom: 4 }}>
                      {q.number ? `${q.number} · ` : ''}
                      {q.title}
                    </div>
                    <div style={{ fontSize: 11, color: T.textFaint, fontFamily: T.fontMono }}>{q.tags.join(' · ')}</div>
                  </div>
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 600,
                      letterSpacing: 0.5,
                      color: qdm.color,
                      background: qdm.bg,
                      padding: '2px 8px',
                      borderRadius: 20,
                    }}
                  >
                    {q.difficulty.toUpperCase()}
                  </span>
                  <button
                    className="pl-btn"
                    disabled={assigned || assigning === q.id || studio.ended}
                    onClick={() => assign(q.id)}
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: assigned ? T.green : T.textMuted,
                      minWidth: 56,
                      textAlign: 'right',
                      background: 'none',
                      border: 'none',
                    }}
                  >
                    {assigned ? 'Assigned' : assigning === q.id ? '…' : 'Assign'}
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {tab === 'notes' && !isInterviewer && (
          <div style={{ padding: '18px 18px 40px' }}>
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: 1, color: T.textFaint, marginBottom: 12 }}>
              SCRATCH · ONLY YOU CAN SEE THIS
            </div>
            <textarea
              value={candNotes}
              onChange={(e) => saveCandNotes(e.target.value)}
              placeholder={'brute force: 2 loops -> O(n^2)\n\nbetter ideas…'}
              style={{
                width: '100%',
                height: 150,
                resize: 'none',
                background: T.bg,
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 8,
                padding: 12,
                color: T.textSoft,
                fontSize: 13,
                lineHeight: 1.65,
                fontFamily: T.fontMono,
                outline: 'none',
              }}
            />
            {hints.length > 0 && (
              <>
                <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: 1, color: T.textFaint, margin: '22px 0 10px' }}>
                  HINTS AVAILABLE
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {hints.map((hint, i) => {
                    const unlockable = i === 0 || hints[i - 1].revealed;
                    return hint.revealed ? (
                      <div
                        key={i}
                        style={{
                          fontSize: 12.5,
                          color: T.blueSoft,
                          background: 'rgba(91,140,255,0.06)',
                          border: '1px solid rgba(91,140,255,0.2)',
                          padding: '11px 13px',
                          borderRadius: 8,
                          lineHeight: 1.5,
                        }}
                      >
                        💡 Hint {i + 1} — {hint.text}
                      </div>
                    ) : (
                      <button
                        key={i}
                        className="pl-btn"
                        disabled={!unlockable || studio.ended}
                        onClick={() => reveal(i)}
                        style={{
                          textAlign: 'left',
                          fontSize: 12.5,
                          color: unlockable ? T.blueSoft : T.textFaint,
                          background: unlockable ? 'rgba(91,140,255,0.06)' : 'rgba(255,255,255,0.03)',
                          border: unlockable ? '1px solid rgba(91,140,255,0.2)' : '1px solid rgba(255,255,255,0.07)',
                          padding: '11px 13px',
                          borderRadius: 8,
                        }}
                      >
                        {unlockable ? `💡 Reveal hint ${i + 1} — your interviewer will see this` : `🔒 Hint ${i + 1} — locked (reveal hint ${i} first)`}
                      </button>
                    );
                  })}
                </div>
                {hintError && (
                  <div role="alert" style={{ fontSize: 12, color: T.redSoft, marginTop: 8 }}>
                    {hintError}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
