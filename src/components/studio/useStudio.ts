'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabaseBrowser } from '@/lib/supabase/client';
import { isUuid } from '@/lib/validation';
import { SESSION_COLUMNS } from '@/lib/types';
import type {
  CaseResult,
  CommentRow,
  HighlightRow,
  HintView,
  LangId,
  Participant,
  RunSummary,
  Session,
  TestCaseRow,
  WbObject,
} from '@/lib/types';

export interface Me {
  userId: string;
  role: 'interviewer' | 'candidate';
  name: string;
  color: string;
}

export interface RemoteCursor {
  userId: string;
  name: string;
  color: string;
  area: 'editor' | 'board';
  line?: number;
  col?: number;
  /** Board position in px. */
  x?: number;
  y?: number;
  ts: number;
}

export interface RunView {
  state: 'idle' | 'running' | 'done' | 'error';
  runId?: string;
  summary?: RunSummary;
  visibleResults?: CaseResult[];
  hiddenResults?: CaseResult[];
  error?: string | null;
  language?: LangId;
}

export type StudioEvent =
  | { type: 'code'; text: string; authorId: string; seq: number }
  | { type: 'lang'; language: LangId; text: string; authorId: string }
  | { type: 'wb-add'; obj: WbObject }
  | { type: 'wb-erase'; ids: string[] }
  | { type: 'wb-preview'; obj: WbObject | null; authorId: string }
  | { type: 'ended' };

type Listener = (e: StudioEvent) => void;

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export function useStudio(sessionId: string) {
  const supabase = supabaseBrowser();

  const [loading, setLoading] = useState(true);
  const [fatal, setFatal] = useState<string | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [onlineIds, setOnlineIds] = useState<Set<string>>(new Set());
  const [testCases, setTestCases] = useState<TestCaseRow[]>([]);
  const [hiddenCount, setHiddenCount] = useState(0);
  const [comments, setComments] = useState<CommentRow[]>([]);
  const [highlights, setHighlights] = useState<HighlightRow[]>([]);
  const [run, setRun] = useState<RunView>({ state: 'idle' });
  const [hints, setHints] = useState<HintView[]>([]);
  const [remoteCursors, setRemoteCursors] = useState<Map<string, RemoteCursor>>(new Map());
  const [typingUser, setTypingUser] = useState<{ name: string; ts: number } | null>(null);
  const [connected, setConnected] = useState(false);
  const [ended, setEnded] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>('idle');

  const channelRef = useRef<RealtimeChannel | null>(null);
  const seqRef = useRef(0);
  // Identifies this page load. seqRef restarts at 0 on reload, so peers track the
  // sequence per (author, load) or they would drop a reloaded author's edits.
  const loadId = useRef(crypto.randomUUID());
  const lastRemoteSeq = useRef<Map<string, number>>(new Map());
  const listenersRef = useRef<Set<Listener>>(new Set());
  const meRef = useRef<Me | null>(null);
  const pendingSaves = useRef(0);
  const dirtyRef = useRef(false); // edits waiting out the save debounce
  // Per-language buffers live here so edits survive the Editor panel unmounting.
  const buffersRef = useRef<Partial<Record<LangId, string>>>({});
  const getBuffer = useCallback((lang: LangId) => buffersRef.current[lang], []);
  const setBuffer = useCallback((lang: LangId, text: string) => {
    buffersRef.current[lang] = text;
  }, []);

  const emit = useCallback((e: StudioEvent) => {
    listenersRef.current.forEach((l) => l(e));
  }, []);

  const subscribe = useCallback((l: Listener) => {
    listenersRef.current.add(l);
    return () => {
      listenersRef.current.delete(l);
    };
  }, []);

  const loadHints = useCallback(async () => {
    const { data } = await supabase.rpc('pl_session_hints', { p_session_id: sessionId });
    setHints(Array.isArray(data) ? (data as HintView[]) : []);
  }, [sessionId, supabase]);

  const loadCore = useCallback(
    async (uid: string) => {
      const [{ data: sess }, { data: parts }, { data: tcs }, { data: cms }, { data: hls }] =
        await Promise.all([
          supabase.from('pl_sessions').select(SESSION_COLUMNS).eq('id', sessionId).maybeSingle(),
          supabase.from('pl_session_participants').select('*').eq('session_id', sessionId).order('joined_at'),
          supabase.from('pl_test_cases').select('*').eq('session_id', sessionId).order('hidden').order('position'),
          supabase.from('pl_comments').select('*').eq('session_id', sessionId).order('created_at'),
          supabase.from('pl_highlights').select('*').eq('session_id', sessionId),
        ]);
      if (!sess) return { mine: null, session: null };
      const s = sess as unknown as Session;
      setSession(s);
      // The server copy is the shared truth; a problem reassignment re-runs this and resets buffers.
      buffersRef.current = { ...(s.starter_code ?? {}), ...(s.code ?? {}) };
      setParticipants((parts as Participant[]) ?? []);
      setTestCases((tcs as TestCaseRow[]) ?? []);
      setComments((cms as CommentRow[]) ?? []);
      setHighlights((hls as HighlightRow[]) ?? []);
      if (s.status === 'completed') setEnded(true);

      const mine = ((parts as Participant[]) ?? []).find((p) => p.user_id === uid) ?? null;
      if (!mine) return { mine: null, session: s };
      const m: Me = { userId: uid, role: mine.role, name: mine.display_name, color: mine.color };
      meRef.current = m;
      setMe(m);

      const [{ data: hc }] = await Promise.all([
        supabase.rpc('pl_hidden_test_count', { p_session_id: sessionId }),
        loadHints(),
      ]);
      setHiddenCount(typeof hc === 'number' ? hc : 0);

      const { data: lastRun } = await supabase
        .from('pl_runs')
        .select('*')
        .eq('session_id', sessionId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (lastRun) {
        const rv: RunView = {
          state: lastRun.status === 'error' ? 'error' : 'done',
          runId: lastRun.id,
          summary: lastRun.summary,
          visibleResults: lastRun.visible_results,
          error: lastRun.error,
          language: lastRun.language,
        };
        if (mine.role === 'interviewer') {
          const { data: hid } = await supabase
            .from('pl_run_hidden_results')
            .select('details')
            .eq('run_id', lastRun.id)
            .maybeSingle();
          if (hid) rv.hiddenResults = hid.details as CaseResult[];
        }
        setRun(rv);
      }
      return { mine, session: s };
    },
    [sessionId, supabase, loadHints]
  );

  useEffect(() => {
    let cancelled = false;
    let channel: RealtimeChannel | null = null;

    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setFatal('not_authenticated');
        setLoading(false);
        return;
      }

      let { mine } = await loadCore(user.id);

      // The creator opening their own room before joining it.
      if (!mine) {
        const { data: sess } = await supabase.from('pl_sessions').select('room_key').eq('id', sessionId).maybeSingle();
        if (sess?.room_key) {
          const res = await fetch('/api/join', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: sess.room_key }),
          }).catch(() => null);
          if (res?.ok) mine = (await loadCore(user.id)).mine;
        }
      }
      if (cancelled) return;
      if (!mine) {
        setFatal('not_participant');
        setLoading(false);
        return;
      }

      // An interviewer opening a scheduled session makes it live.
      const { data: fresh } = await supabase.from('pl_sessions').select('status,started_at').eq('id', sessionId).single();
      if (cancelled) return;
      if (fresh?.status === 'scheduled' && mine.role === 'interviewer') {
        const startedAt = new Date().toISOString();
        await supabase.from('pl_sessions').update({ status: 'live', started_at: startedAt }).eq('id', sessionId);
        setSession((s) => (s ? { ...s, status: 'live', started_at: startedAt } : s));
      }

      await supabase.realtime.setAuth(); // private channels authorize with the user's JWT
      if (cancelled) return; // unmounted during the awaits; cleanup never saw a channel
      channel = supabase.channel(`pl:session:${sessionId}`, {
        config: { private: true, broadcast: { self: false }, presence: { key: user.id } },
      });
      channelRef.current = channel;

      channel.on('presence', { event: 'sync' }, () => {
        const state = channel!.presenceState();
        setOnlineIds(new Set(Object.keys(state)));
      });

      channel.on('broadcast', { event: 'cursor' }, ({ payload }) => {
        const p = payload as RemoteCursor;
        if (p.userId === meRef.current?.userId) return;
        setRemoteCursors((m) => new Map(m).set(p.userId, { ...p, ts: Date.now() }));
      });

      channel.on('broadcast', { event: 'code' }, ({ payload }) => {
        const p = payload as { text: string; authorId: string; seq: number; loadId?: string };
        if (p.authorId === meRef.current?.userId) return;
        // Drop stale or reordered edits.
        const sender = `${p.authorId}:${p.loadId ?? ''}`;
        if (p.seq <= (lastRemoteSeq.current.get(sender) ?? 0)) return;
        lastRemoteSeq.current.set(sender, p.seq);
        emit({ type: 'code', text: p.text, authorId: p.authorId, seq: p.seq });
      });

      channel.on('broadcast', { event: 'lang' }, ({ payload }) => {
        const p = payload as { language: LangId; text: string; authorId: string };
        if (p.authorId === meRef.current?.userId) return;
        setSession((s) => (s ? { ...s, language: p.language } : s));
        emit({ type: 'lang', ...p });
      });

      channel.on('broadcast', { event: 'typing' }, ({ payload }) => {
        const p = payload as { userId: string; name: string };
        if (p.userId === meRef.current?.userId) return;
        setTypingUser({ name: p.name, ts: Date.now() });
      });

      // Anyone on the channel can send any payload, so comment, highlight, run and
      // session broadcasts are only signals to re-read the row under our own RLS.
      channel.on('broadcast', { event: 'comment' }, ({ payload }) => {
        const id = (payload as { id?: unknown })?.id;
        if (!isUuid(id)) return;
        supabase
          .from('pl_comments')
          .select('*')
          .eq('id', id)
          .eq('session_id', sessionId)
          .maybeSingle()
          .then(({ data }) => {
            if (!data) return;
            const row = data as CommentRow;
            setComments((cur) => (cur.some((x) => x.id === row.id) ? cur : [...cur, row]));
          });
      });

      channel.on('broadcast', { event: 'highlight' }, ({ payload }) => {
        const p = payload as { action: 'add' | 'remove-line' | 'clear'; row?: HighlightRow; line?: number };
        if (p.action === 'add' && isUuid(p.row?.id)) {
          const id = p.row!.id;
          supabase
            .from('pl_highlights')
            .select('*')
            .eq('id', id)
            .eq('session_id', sessionId)
            .maybeSingle()
            .then(({ data }) => {
              if (!data) return;
              const row = data as HighlightRow;
              setHighlights((h) => (h.some((x) => x.id === row.id) ? h : [...h, row]));
            });
          return;
        }
        if (p.action === 'remove-line' || p.action === 'clear') {
          supabase
            .from('pl_highlights')
            .select('*')
            .eq('session_id', sessionId)
            .then(({ data }) => {
              if (data) setHighlights(data as HighlightRow[]);
            });
        }
      });

      channel.on('broadcast', { event: 'run' }, ({ payload }) => {
        const p = payload as { state: string; runId?: string };
        if (p.state === 'running') {
          setRun((r) => ({ ...r, state: 'running' }));
          return;
        }
        // A failed run has no row to re-read. Only clear a spinner, so a forged
        // message can't replace real results.
        if (p.state === 'error') {
          setRun((r) => (r.state === 'running' ? { ...r, state: 'error', error: 'The run could not be completed. Try again.' } : r));
          return;
        }
        // Only the service role writes pl_runs, so the row can't be forged.
        if (p.state === 'done' && p.runId) {
          supabase
            .from('pl_runs')
            .select('id,status,summary,visible_results,error,language')
            .eq('id', p.runId)
            .maybeSingle()
            .then(({ data }) => {
              if (!data) return;
              setRun({
                state: data.status === 'error' ? 'error' : 'done',
                runId: data.id,
                summary: data.summary as RunSummary,
                visibleResults: data.visible_results as CaseResult[],
                error: data.error,
                language: data.language as LangId,
              });
              if (meRef.current?.role === 'interviewer') {
                supabase
                  .from('pl_run_hidden_results')
                  .select('details')
                  .eq('run_id', data.id)
                  .maybeSingle()
                  .then(({ data: hd }) => {
                    if (hd) setRun((r) => (r.runId === data.id ? { ...r, hiddenResults: hd.details as CaseResult[] } : r));
                  });
              }
            });
        }
      });

      channel.on('broadcast', { event: 'hint' }, () => {
        loadHints();
      });

      channel.on('broadcast', { event: 'wb' }, ({ payload }) => {
        const p = payload as { action: 'add' | 'erase' | 'preview'; obj?: WbObject; ids?: string[]; authorId: string };
        if (p.authorId === meRef.current?.userId) return;
        if (p.action === 'add' && p.obj) emit({ type: 'wb-add', obj: p.obj });
        if (p.action === 'erase' && p.ids) emit({ type: 'wb-erase', ids: p.ids });
        if (p.action === 'preview') emit({ type: 'wb-preview', obj: p.obj ?? null, authorId: p.authorId });
      });

      channel.on('broadcast', { event: 'session' }, async ({ payload }) => {
        const p = payload as { type: string };
        if (p.type === 'ended') {
          const { data } = await supabase.from('pl_sessions').select('status').eq('id', sessionId).maybeSingle();
          if (data?.status === 'completed') {
            setEnded(true);
            setSession((s) => (s ? { ...s, status: 'completed' } : s));
          }
        }
        if (p.type === 'problem_assigned') {
          const m = meRef.current;
          if (!m) return;
          const { session: fresh } = await loadCore(m.userId);
          if (fresh) {
            const text = fresh.code?.[fresh.language] ?? fresh.starter_code?.[fresh.language] ?? '';
            emit({ type: 'lang', language: fresh.language, text, authorId: 'server' });
          }
        }
      });

      channel.subscribe(async (status) => {
        setConnected(status === 'SUBSCRIBED');
        if (status === 'SUBSCRIBED') {
          const m = meRef.current;
          await channel!.track({ userId: user.id, name: m?.name ?? '', role: m?.role ?? '', color: m?.color ?? '' });
        }
      });

      setLoading(false);
    })();

    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
      channelRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // Drop cursors and the typing indicator once peers go quiet.
  useEffect(() => {
    const iv = setInterval(() => {
      setRemoteCursors((m) => {
        const now = Date.now();
        let changed = false;
        const next = new Map(m);
        for (const [k, v] of next) {
          if (now - v.ts > 6000) {
            next.delete(k);
            changed = true;
          }
        }
        return changed ? next : m;
      });
      setTypingUser((t) => (t && Date.now() - t.ts > 3000 ? null : t));
    }, 2000);
    return () => clearInterval(iv);
  }, []);

  // Unsaved edits exist only in memory, so warn before a reload or close would drop them.
  useEffect(() => {
    if (ended || (saveState !== 'saving' && saveState !== 'error')) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [saveState, ended]);

  const sendBroadcast = useCallback((event: string, payload: unknown) => {
    channelRef.current?.send({ type: 'broadcast', event, payload });
  }, []);

  const broadcastCode = useCallback(
    (text: string) => {
      const m = meRef.current;
      if (!m) return;
      seqRef.current += 1; // a counter, not wall-clock, so clock changes can't reorder edits
      sendBroadcast('code', { text, authorId: m.userId, seq: seqRef.current, loadId: loadId.current });
      sendBroadcast('typing', { userId: m.userId, name: m.name });
    },
    [sendBroadcast]
  );

  const saveCode = useCallback(
    async (language: LangId, text: string) => {
      pendingSaves.current += 1;
      dirtyRef.current = false;
      setSaveState('saving');
      const { error } = await supabase.rpc('pl_save_code', { p_session_id: sessionId, p_language: language, p_code: text });
      pendingSaves.current -= 1;
      if (error) setSaveState('error');
      else if (pendingSaves.current === 0 && !dirtyRef.current) setSaveState('saved');
    },
    [sessionId, supabase]
  );

  /** A local edit is waiting for the debounced save. */
  const markDirty = useCallback(() => {
    dirtyRef.current = true;
    setSaveState('saving');
  }, []);

  /** A peer or the server replaced the document, so the pending save was dropped on purpose. */
  const markClean = useCallback(() => {
    dirtyRef.current = false;
    if (pendingSaves.current === 0) setSaveState('idle');
  }, []);

  const broadcastCursor = useCallback(
    (c: Omit<RemoteCursor, 'userId' | 'name' | 'color' | 'ts'>) => {
      const m = meRef.current;
      if (!m) return;
      sendBroadcast('cursor', { ...c, userId: m.userId, name: m.name, color: m.color });
    },
    [sendBroadcast]
  );

  const setLanguage = useCallback(
    async (language: LangId, text: string) => {
      const m = meRef.current;
      setSession((s) => (s ? { ...s, language } : s));
      sendBroadcast('lang', { language, text, authorId: m?.userId });
      await saveCode(language, text);
    },
    [saveCode, sendBroadcast]
  );

  const addComment = useCallback(
    async (lineNumber: number, body: string) => {
      const m = meRef.current;
      if (!m || !body.trim()) return;
      const { data, error } = await supabase
        .from('pl_comments')
        .insert({
          session_id: sessionId,
          line_number: lineNumber,
          author_id: m.userId,
          author_name: m.name,
          author_role: m.role,
          body: body.trim().slice(0, 4000),
        })
        .select('*')
        .single();
      if (!error && data) {
        setComments((c) => [...c, data as CommentRow]);
        sendBroadcast('comment', { id: data.id });
      }
    },
    [sessionId, supabase, sendBroadcast]
  );

  const toggleLinePin = useCallback(
    async (lineNumber: number) => {
      const m = meRef.current;
      if (!m || m.role !== 'interviewer') return;
      const existing = highlights.filter((h) => h.line_number === lineNumber);
      if (existing.length) {
        await supabase.from('pl_highlights').delete().eq('session_id', sessionId).eq('line_number', lineNumber);
        setHighlights((h) => h.filter((x) => x.line_number !== lineNumber));
        sendBroadcast('highlight', { action: 'remove-line', line: lineNumber });
      } else {
        const { data } = await supabase
          .from('pl_highlights')
          .insert({ session_id: sessionId, line_number: lineNumber, created_by: m.userId })
          .select('*')
          .single();
        if (data) {
          setHighlights((h) => [...h, data as HighlightRow]);
          sendBroadcast('highlight', { action: 'add', row: data });
        }
      }
    },
    [highlights, sessionId, supabase, sendBroadcast]
  );

  const addRangePin = useCallback(
    async (lineNumber: number, colStart: number, colEnd: number) => {
      const m = meRef.current;
      if (!m || m.role !== 'interviewer') return;
      const { data } = await supabase
        .from('pl_highlights')
        .insert({ session_id: sessionId, line_number: lineNumber, col_start: colStart, col_end: colEnd, created_by: m.userId })
        .select('*')
        .single();
      if (data) {
        setHighlights((h) => [...h, data as HighlightRow]);
        sendBroadcast('highlight', { action: 'add', row: data });
      }
    },
    [sessionId, supabase, sendBroadcast]
  );

  const runCode = useCallback(
    async (language: LangId, code: string) => {
      setRun((r) => ({ ...r, state: 'running', language }));
      try {
        const res = await fetch('/api/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId, language, code }),
        });
        const json = await res.json();
        if (!res.ok) {
          setRun((r) => ({ ...r, state: 'error', error: json.error ?? 'Run failed', language }));
          return;
        }
        setRun({
          state: json.error ? 'error' : 'done',
          runId: json.runId,
          summary: json.summary,
          visibleResults: json.visibleResults,
          hiddenResults: json.hiddenResults,
          error: json.error,
          language,
        });
      } catch {
        setRun((r) => ({ ...r, state: 'error', error: 'Network error', language }));
      }
    },
    [sessionId]
  );

  const endSession = useCallback(async (): Promise<boolean> => {
    try {
      const res = await fetch(`/api/sessions/${sessionId}/end`, { method: 'POST' });
      if (!res.ok) {
        // The route also answers 403 when the session is already over, e.g. a co-interviewer ended it.
        const { data } = await supabase.from('pl_sessions').select('status').eq('id', sessionId).maybeSingle();
        if (data?.status !== 'completed') return false;
      }
    } catch {
      return false;
    }
    setEnded(true);
    setSession((s) => (s ? { ...s, status: 'completed' } : s));
    return true;
  }, [sessionId, supabase]);

  /** Returns the server's error code, or null on success. */
  const revealHint = useCallback(
    async (index: number): Promise<string | null> => {
      const m = meRef.current;
      // Real role, not the preview role: an interviewer previewing must not reveal hints.
      if (!m || m.role !== 'candidate') return null;
      // The server enforces the ladder and records the reveal before returning the text.
      const { data, error } = await supabase.rpc('pl_reveal_hint', { p_session_id: sessionId, p_index: index });
      if (error) {
        await loadHints();
        return error.message;
      }
      const text = typeof data === 'string' ? data : null;
      setHints((hs) => hs.map((h) => (h.index === index ? { ...h, revealed: true, text } : h)));
      sendBroadcast('hint', { index });
      return null;
    },
    [sessionId, supabase, sendBroadcast, loadHints]
  );

  const wbAdd = useCallback(
    (obj: WbObject) => {
      const m = meRef.current;
      if (!m) return;
      sendBroadcast('wb', { action: 'add', obj, authorId: m.userId });
      supabase.from('pl_whiteboard_events').insert({ session_id: sessionId, author_id: m.userId, kind: 'add', payload: obj }).then();
    },
    [sessionId, supabase, sendBroadcast]
  );

  const wbErase = useCallback(
    (ids: string[]) => {
      const m = meRef.current;
      if (!m || !ids.length) return;
      sendBroadcast('wb', { action: 'erase', ids, authorId: m.userId });
      supabase.from('pl_whiteboard_events').insert({ session_id: sessionId, author_id: m.userId, kind: 'erase', payload: { ids } }).then();
    },
    [sessionId, supabase, sendBroadcast]
  );

  const wbPreview = useCallback(
    (obj: WbObject | null) => {
      const m = meRef.current;
      if (!m) return;
      sendBroadcast('wb', { action: 'preview', obj, authorId: m.userId });
    },
    [sendBroadcast]
  );

  const loadWhiteboard = useCallback(async (): Promise<WbObject[]> => {
    const { data } = await supabase
      .from('pl_whiteboard_events')
      .select('kind,payload')
      .eq('session_id', sessionId)
      .order('id');
    const map = new Map<string, WbObject>();
    for (const ev of (data as { kind: string; payload: unknown }[]) ?? []) {
      if (ev.kind === 'add') {
        const obj = ev.payload as WbObject;
        map.set(obj.id, obj);
      } else if (ev.kind === 'erase') {
        for (const id of (ev.payload as { ids: string[] }).ids ?? []) map.delete(id);
      } else if (ev.kind === 'clear') {
        map.clear();
      }
    }
    return [...map.values()];
  }, [sessionId, supabase]);

  // RLS pins only author_id on pl_comments, so author_name/author_role are client-written
  // and spoofable. Take identity from pl_session_participants, which clients can't write.
  const resolvedComments = useMemo(() => {
    if (!participants.length) return comments;
    const byUser = new Map(participants.map((p) => [p.user_id, p]));
    return comments.map((c) => {
      const p = byUser.get(c.author_id);
      if (!p || (p.role === c.author_role && p.display_name === c.author_name)) return c;
      return { ...c, author_role: p.role, author_name: p.display_name };
    });
  }, [comments, participants]);

  return {
    loading,
    fatal,
    session,
    me,
    participants,
    onlineIds,
    testCases,
    hiddenCount,
    comments: resolvedComments,
    highlights,
    run,
    hints,
    remoteCursors,
    typingName: typingUser?.name ?? null,
    connected,
    ended,
    saveState,
    markDirty,
    markClean,
    subscribe,
    broadcastCode,
    broadcastCursor,
    saveCode,
    getBuffer,
    setBuffer,
    setLanguage,
    addComment,
    toggleLinePin,
    addRangePin,
    runCode,
    endSession,
    revealHint,
    wbAdd,
    wbErase,
    wbPreview,
    loadWhiteboard,
    supabase,
    sessionId,
  };
}

export type Studio = ReturnType<typeof useStudio>;
