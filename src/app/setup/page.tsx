'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase/client';
import { generateRoomKey } from '@/lib/keys';
import { T } from '@/lib/theme';
import { MAX_TEST_FIELD_LEN, validateEmailList } from '@/lib/validation';
import type { Difficulty, Problem } from '@/lib/types';

interface TestRow {
  input: string;
  expected: string;
}

const isComplete = (t: TestRow) => Boolean(t.input.trim() && t.expected.trim());
// An empty input is a valid no-argument case; an empty expected output can never pass.
const missingExpected = (t: TestRow) => Boolean(t.input.trim() && !t.expected.trim());
const isTooLong = (t: TestRow) => t.input.length > MAX_TEST_FIELD_LEN || t.expected.length > MAX_TEST_FIELD_LEN;

function FieldError({ children }: { children: React.ReactNode }) {
  return (
    <div
      role="alert"
      style={{
        fontSize: 11,
        color: T.red,
        background: 'rgba(255,92,108,0.06)',
        border: '1px solid rgba(255,92,108,0.2)',
        borderRadius: 6,
        padding: '4px 8px',
        display: 'flex',
        alignItems: 'center',
        gap: 6,
      }}
    >
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={T.red} strokeWidth="2.5">
        <circle cx="12" cy="12" r="10" />
        <path d="M12 8v4M12 16h.01" />
      </svg>
      {children}
    </div>
  );
}

const sectionLabel: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: 1,
  color: T.textFaint,
  marginBottom: 14,
};

function TestRows({
  rows,
  onChange,
  accent,
}: {
  rows: TestRow[];
  onChange: (rows: TestRow[]) => void;
  accent: 'green' | 'yellow';
}) {
  const cls = accent === 'yellow' ? 'pl-input pl-input--yellow' : 'pl-input';
  const outColor = accent === 'yellow' ? T.yellow : T.green;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {rows.map((t, i) => (
        <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <span style={{ fontFamily: T.fontMono, fontSize: 11, color: T.textFaint, width: 16, textAlign: 'right' }}>
            {i + 1}
          </span>
          <input
            className={cls}
            value={t.input}
            placeholder="input   e.g. nums=[2,7,11,15], target=9"
            onChange={(e) => onChange(rows.map((r, x) => (x === i ? { ...r, input: e.target.value } : r)))}
            style={{ flex: 2, padding: '9px 12px', borderRadius: 8, fontFamily: T.fontMono, fontSize: 12.5, color: T.textSoft }}
          />
          <span style={{ color: T.textFaint }}>→</span>
          <input
            className={cls}
            value={t.expected}
            placeholder="expected output"
            onChange={(e) => onChange(rows.map((r, x) => (x === i ? { ...r, expected: e.target.value } : r)))}
            style={{ flex: 1, padding: '9px 12px', borderRadius: 8, fontFamily: T.fontMono, fontSize: 12.5, color: outColor }}
          />
          <button
            className="pl-btn"
            title="Remove"
            onClick={() => onChange(rows.filter((_, x) => x !== i))}
            style={{
              width: 32,
              height: 32,
              flex: '0 0 32px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: T.textMuted,
              background: 'transparent',
              border: `1px solid ${T.borderInput}`,
              borderRadius: 8,
              fontSize: 16,
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

export default function SetupPage() {
  const router = useRouter();
  const supabase = supabaseBrowser();

  const [candidateName, setCandidateName] = useState('');
  const [candidateRoleLabel, setCandidateRoleLabel] = useState('');
  const [difficulty, setDifficulty] = useState<Difficulty>('easy');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [visible, setVisible] = useState<TestRow[]>([{ input: '', expected: '' }]);
  const [hidden, setHidden] = useState<TestRow[]>([{ input: '', expected: '' }]);
  const [invites, setInvites] = useState('');
  const [roomKey, setRoomKey] = useState('');
  const [bank, setBank] = useState<Problem[]>([]);
  const [selectedProblem, setSelectedProblem] = useState<Problem | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [copied, setCopied] = useState(false);
  const emailValidation = useMemo(() => validateEmailList(invites), [invites]);

  useEffect(() => {
    setRoomKey(generateRoomKey());
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user || user.is_anonymous) {
        router.replace('/');
        return;
      }
      // hidden_tests is revoked from clients; the server merges them in at create time.
      const { data } = await supabase
        .from('pl_problems')
        .select('id,owner_id,number,title,difficulty,description,follow_up,tags,hints,starter_code,visible_tests,created_at')
        .order('number');
      const problems = (data as Problem[]) ?? [];
      setBank(problems);
      const twoSum = problems.find((p) => p.number === 1) ?? problems[0];
      if (twoSum) loadProblem(twoSum);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function loadProblem(p: Problem) {
    setSelectedProblem(p);
    setTitle(`${p.number ? `${p.number}. ` : ''}${p.title}`);
    setDifficulty(p.difficulty);
    setDescription(p.description);
    setVisible((p.visible_tests ?? []).length ? p.visible_tests : [{ input: '', expected: '' }]);
    // The bank problem's own hidden tests are added on the server; these are extras.
    setHidden([{ input: '', expected: '' }]);
  }

  function validate(): string | null {
    if (!candidateName.trim()) return 'Enter the candidate’s name.';
    if (!title.trim()) return 'Enter a problem title.';
    const badEmails = emailValidation.filter((e) => !e.valid);
    if (badEmails.length) return `Fix the invalid email(s): ${badEmails.map((e) => e.email).join(', ')}`;
    if (!visible.some(isComplete)) return 'Add at least one visible test case with both an input and an expected output.';
    if ([...visible, ...hidden].some(missingExpected)) return 'Every test case with an input needs an expected output.';
    if ([...visible, ...hidden].some(isTooLong)) {
      return `Each test input and expected output must be under ${MAX_TEST_FIELD_LEN.toLocaleString()} characters.`;
    }
    return null;
  }

  async function createAndLaunch() {
    setSubmitted(true);
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const numMatch = title.match(/^(\d+)\.\s*(.*)$/);
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          candidateName,
          candidateRoleLabel,
          problemId: selectedProblem?.id ?? null,
          problemNumber: numMatch ? parseInt(numMatch[1], 10) : (selectedProblem?.number ?? null),
          problemTitle: numMatch ? numMatch[2] : title,
          difficulty,
          description,
          followUp: selectedProblem?.follow_up ?? null,
          tags: selectedProblem?.tags ?? [],
          hints: selectedProblem?.hints ?? [],
          starterCode: selectedProblem?.starter_code ?? {},
          visibleTests: visible,
          hiddenTests: hidden,
          inviteEmails: emailValidation.filter((e) => e.valid).map((e) => e.email),
          roomKey,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Failed to create');
      router.push(`/studio/${json.sessionId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create session');
      setBusy(false);
    }
  }

  const segBtn = (active: boolean): React.CSSProperties =>
    active
      ? { flex: 1, textAlign: 'center', fontSize: 12.5, fontWeight: 600, color: T.greenDark, background: T.green, padding: 8, borderRadius: 6, cursor: 'pointer', border: 'none', fontFamily: 'inherit' }
      : { flex: 1, textAlign: 'center', fontSize: 12.5, color: T.textMuted, padding: 8, cursor: 'pointer', background: 'transparent', border: 'none', fontFamily: 'inherit' };

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: T.bg, color: T.text, fontFamily: T.fontUI }}>
      <header
        style={{
          height: 58,
          flex: '0 0 58px',
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          padding: '0 22px',
          borderBottom: `1px solid ${T.border}`,
          background: T.bgHeader,
        }}
      >
        <button
          className="pl-btn"
          onClick={() => router.push('/dashboard')}
          style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, color: T.textMuted, background: 'transparent' }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M15 18l-6-6 6-6" />
          </svg>
          Dashboard
        </button>
        <div style={{ width: 1, height: 22, background: 'rgba(255,255,255,0.08)' }} />
        <span style={{ fontSize: 14, fontWeight: 600 }}>New interview</span>
        <div style={{ flex: 1 }} />
        <button className="pl-btn pl-btn-ghost" onClick={() => router.push('/dashboard')} style={{ padding: '8px 14px' }}>
          Cancel
        </button>
        <button
          className="pl-btn"
          onClick={createAndLaunch}
          disabled={busy}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 7,
            fontSize: 13,
            fontWeight: 600,
            color: T.greenDark,
            background: T.green,
            padding: '9px 16px',
            borderRadius: 9,
            boxShadow: '0 0 16px rgba(61,220,151,0.3)',
          }}
        >
          {busy ? 'Creating…' : 'Create & launch →'}
        </button>
      </header>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        <div style={{ maxWidth: 820, margin: '0 auto', padding: '32px 28px 64px', display: 'flex', flexDirection: 'column', gap: 28 }}>
          {error && (
            <div
              style={{
                background: 'rgba(255,92,108,0.08)',
                border: '1px solid rgba(255,92,108,0.3)',
                color: T.redSoft,
                borderRadius: 10,
                padding: '10px 14px',
                fontSize: 13,
              }}
            >
              {error}
            </div>
          )}

          <section>
            <div style={sectionLabel}>CANDIDATE &amp; PROBLEM</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                <label className="pl-label">CANDIDATE NAME</label>
                <input
                  className="pl-input"
                  style={{ padding: '11px 13px' }}
                  value={candidateName}
                  onChange={(e) => setCandidateName(e.target.value)}
                  placeholder="Priya Nair"
                />
                {submitted && !candidateName.trim() && <FieldError>Required</FieldError>}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                <label className="pl-label">DIFFICULTY</label>
                <div style={{ display: 'flex', background: T.bg, border: `1px solid ${T.borderInput}`, borderRadius: 9, padding: 3 }}>
                  {(['easy', 'medium', 'hard'] as const).map((d) => (
                    <button key={d} style={segBtn(difficulty === d)} onClick={() => setDifficulty(d)}>
                      {d[0].toUpperCase() + d.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                <label className="pl-label">CANDIDATE ROLE</label>
                <input
                  className="pl-input"
                  style={{ padding: '11px 13px' }}
                  value={candidateRoleLabel}
                  onChange={(e) => setCandidateRoleLabel(e.target.value)}
                  placeholder="Senior Backend · R2"
                />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                <label className="pl-label">FROM QUESTION BANK</label>
                <select
                  className="pl-input"
                  style={{ padding: '11px 13px', appearance: 'none' }}
                  value={selectedProblem?.id ?? ''}
                  onChange={(e) => {
                    const p = bank.find((b) => b.id === e.target.value);
                    if (p) loadProblem(p);
                  }}
                >
                  <option value="" disabled>
                    Pick a problem…
                  </option>
                  {bank.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.number ? `${p.number} · ` : ''}
                      {p.title}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginBottom: 16 }}>
              <label className="pl-label">PROBLEM TITLE</label>
              <input className="pl-input" style={{ padding: '11px 13px' }} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Two Sum, Merge Intervals" />
              {submitted && !title.trim() && <FieldError>Problem title is required</FieldError>}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              <label className="pl-label">DESCRIPTION</label>
              <textarea
                className="pl-input"
                style={{ height: 92, resize: 'none', padding: '11px 13px', fontSize: 13.5, lineHeight: 1.6 }}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
          </section>

          <section>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 9 }}>
                <span style={{ fontSize: 14, fontWeight: 600 }}>Visible test cases</span>
                <span style={{ fontSize: 11, color: T.textFaint }}>Shown to the candidate</span>
              </div>
              <button
                className="pl-btn"
                onClick={() => setVisible([...visible, { input: '', expected: '' }])}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  fontSize: 12,
                  fontWeight: 600,
                  color: T.green,
                  background: 'rgba(61,220,151,0.1)',
                  border: '1px solid rgba(61,220,151,0.28)',
                  padding: '6px 12px',
                  borderRadius: 8,
                }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={T.green} strokeWidth="2.5">
                  <path d="M12 5v14M5 12h14" />
                </svg>
                Add case
              </button>
            </div>
            <TestRows rows={visible} onChange={setVisible} accent="green" />
            {submitted && visible.some(missingExpected) && (
              <div
                style={{
                  fontSize: 11,
                  color: T.yellow,
                  background: 'rgba(255,212,121,0.06)',
                  border: `1px solid rgba(255,212,121,0.25)`,
                  borderRadius: 6,
                  padding: '6px 10px',
                  margin: '8px 0 0',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={T.yellow} strokeWidth="2">
                  <path d="M12 2L2 20h20z" />
                  <path d="M12 9v4M12 17h.01" />
                </svg>
                Add an expected output to every case that has an input. Completely empty rows are ignored.
              </div>
            )}
          </section>

          <section style={{ border: '1px solid rgba(255,212,121,0.22)', background: 'rgba(255,212,121,0.03)', borderRadius: 12, padding: 18 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={T.yellow} strokeWidth="2">
                  <rect x="4" y="10" width="16" height="10" rx="2" />
                  <path d="M8 10V7a4 4 0 018 0v3" />
                </svg>
                <span style={{ fontSize: 14, fontWeight: 600, color: T.yellow }}>Hidden test cases</span>
              </div>
              <button
                className="pl-btn"
                onClick={() => setHidden([...hidden, { input: '', expected: '' }])}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  fontSize: 12,
                  fontWeight: 600,
                  color: T.yellow,
                  background: 'rgba(255,212,121,0.1)',
                  border: '1px solid rgba(255,212,121,0.3)',
                  padding: '6px 12px',
                  borderRadius: 8,
                }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={T.yellow} strokeWidth="2.5">
                  <path d="M12 5v14M5 12h14" />
                </svg>
                Add hidden
              </button>
            </div>
            <p style={{ fontSize: 11.5, color: T.textMuted, margin: '0 0 15px', lineHeight: 1.5 }}>
              Used to grade the solution but never shown to the candidate. They only see a pass count. Inputs use
              the same format as visible cases, e.g. <code>nums=[1,2], target=3</code>.
            </p>
            <TestRows rows={hidden} onChange={setHidden} accent="yellow" />
          </section>

          <section>
            <div style={{ ...sectionLabel, marginBottom: 12 }}>CO-INTERVIEWERS (OPTIONAL)</div>
            <input
              className="pl-input"
              value={invites}
              onChange={(e) => setInvites(e.target.value)}
              placeholder="emails, comma separated — they join with the same key as interviewers"
              style={{ padding: '11px 13px' }}
            />
            {emailValidation.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, margin: '10px 0 0' }}>
                {emailValidation.map((result, i) => (
                  <div
                    key={i}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 9,
                      padding: '8px 11px',
                      borderRadius: 8,
                      background: result.valid ? 'rgba(61,220,151,0.08)' : 'rgba(255,92,108,0.08)',
                      border: `1px solid ${result.valid ? 'rgba(61,220,151,0.2)' : 'rgba(255,92,108,0.2)'}`,
                    }}
                  >
                    <span
                      style={{
                        width: 5,
                        height: 5,
                        borderRadius: '50%',
                        background: result.valid ? T.green : T.red,
                      }}
                    />
                    <span style={{ fontFamily: T.fontMono, fontSize: 12, color: result.valid ? T.greenSoft : T.redSoft, flex: 1 }}>
                      {result.email}
                    </span>
                    {!result.valid && (
                      <span style={{ fontSize: 11, color: T.red }}>
                        {result.error}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
            <p style={{ fontSize: 11.5, color: T.textFaint, margin: '8px 2px 0' }}>
              Only these signed-in accounts (plus you) can enter this room as interviewer. Everyone else who uses the
              key gets the candidate seat.
            </p>
          </section>

          <section>
            <div style={{ ...sectionLabel, marginBottom: 12 }}>CONNECT KEY</div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 14,
                background: T.bgCard,
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 12,
                padding: '16px 18px',
              }}
            >
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: T.blue, boxShadow: '0 0 8px rgba(91,140,255,0.7)' }} />
              <span style={{ fontFamily: T.fontMono, fontSize: 22, fontWeight: 600, letterSpacing: 3, color: T.blueSoft }}>
                {roomKey}
              </span>
              <div style={{ flex: 1 }} />
              <button
                className="pl-btn"
                onClick={() => setRoomKey(generateRoomKey())}
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: T.textSoft,
                  background: 'rgba(255,255,255,0.04)',
                  border: `1px solid ${T.borderInput}`,
                  padding: '8px 13px',
                  borderRadius: 8,
                }}
              >
                Regenerate
              </button>
              <button
                className="pl-btn"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(roomKey);
                  } catch {
                    return;
                  }
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
                style={{ fontSize: 12, fontWeight: 600, color: T.greenDark, background: T.green, padding: '8px 14px', borderRadius: 8 }}
              >
                {copied ? 'Copied ✓' : 'Copy'}
              </button>
            </div>
            <p style={{ fontSize: 11.5, color: T.textFaint, margin: '10px 2px 0' }}>
              Share this key with your candidate. Both of you enter the room with the same key.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
