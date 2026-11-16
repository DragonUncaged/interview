'use client';

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { EditorState, Compartment, StateEffect, StateField, Annotation, RangeSetBuilder } from '@codemirror/state';
import {
  EditorView,
  keymap,
  lineNumbers,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  Decoration,
  type DecorationSet,
  WidgetType,
  gutterLineClass,
  GutterMarker,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { indentUnit, syntaxHighlighting, HighlightStyle, bracketMatching } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import { python } from '@codemirror/lang-python';
import { javascript } from '@codemirror/lang-javascript';
import { java } from '@codemirror/lang-java';
import { cpp } from '@codemirror/lang-cpp';
import { go } from '@codemirror/lang-go';
import { simpleDiff } from '@/lib/diff';
import { T, initials as initialsOf, ROLE_COLORS } from '@/lib/theme';
import type { CommentRow, HighlightRow, LangId, Role } from '@/lib/types';
import type { RemoteCursor } from './useStudio';

const remoteAnnotation = Annotation.define<boolean>();

function langExt(lang: LangId) {
  switch (lang) {
    case 'python':
      return python();
    case 'javascript':
      return javascript();
    case 'java':
      return java();
    case 'cpp':
      return cpp();
    case 'go':
      return go();
  }
}

const plTheme = EditorView.theme(
  {
    '&': { color: T.code.txt },
    '.cm-content': { caretColor: T.text, paddingRight: '20px' },
    '.cm-selectionBackground': { background: 'rgba(61,220,151,0.18) !important' },
  },
  { dark: true }
);

const plHighlight = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.operatorKeyword], color: T.code.kw },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: T.code.fn },
  { tag: [t.typeName, t.className, t.namespace], color: T.code.ty },
  { tag: [t.string, t.special(t.string)], color: T.code.str },
  { tag: [t.number, t.bool, t.null], color: T.code.num },
  { tag: [t.comment, t.lineComment, t.blockComment], color: T.code.cm, fontStyle: 'italic' },
  { tag: [t.punctuation, t.bracket, t.operator], color: T.code.punc },
  { tag: [t.propertyName, t.attributeName], color: T.code.ty },
  { tag: [t.variableName, t.name], color: T.code.txt },
  { tag: t.self, color: T.code.kw },
]);

class RemoteCursorWidget extends WidgetType {
  constructor(
    private name: string,
    private color: string
  ) {
    super();
  }
  eq(other: RemoteCursorWidget) {
    return other.name === this.name && other.color === this.color;
  }
  toDOM() {
    const span = document.createElement('span');
    span.className = 'pl-remote-cursor';
    span.style.background = this.color;
    const tag = document.createElement('span');
    tag.className = 'pl-remote-tag';
    tag.style.background = this.color;
    tag.textContent = this.name.split(' ')[0] || this.name;
    span.appendChild(tag);
    return span;
  }
  ignoreEvent() {
    return true;
  }
}

interface ThreadCallbacks {
  onSubmit: (line: number, text: string) => void;
  onClose: () => void;
}

class ThreadWidget extends WidgetType {
  constructor(
    private line: number,
    private comments: CommentRow[],
    private composerOpen: boolean,
    private meRole: Role,
    private meName: string,
    private cb: ThreadCallbacks
  ) {
    super();
  }

  eq(other: ThreadWidget) {
    return (
      other.line === this.line &&
      other.composerOpen === this.composerOpen &&
      other.comments.length === this.comments.length &&
      // Author identity can resolve after the comments load, so compare it too.
      other.comments.every(
        (c, i) =>
          c.id === this.comments[i].id &&
          c.author_name === this.comments[i].author_name &&
          c.author_role === this.comments[i].author_role
      ) &&
      other.meRole === this.meRole
    );
  }

  // Built outside React, so every user-supplied string must go through escapeHtml.
  toDOM() {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'padding:0; margin:0;';

    if (this.comments.length) {
      const box = document.createElement('div');
      box.style.cssText = `margin:6px 20px 10px 54px;background:${T.bgCard};border:1px solid rgba(255,255,255,0.08);border-radius:10px;overflow:hidden;font-family:${T.fontUI};`;
      const head = document.createElement('div');
      head.style.cssText =
        'display:flex;align-items:center;gap:8px;padding:9px 14px;background:rgba(61,220,151,0.05);border-bottom:1px solid rgba(255,255,255,0.06);';
      head.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="${T.green}" stroke-width="2"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg><span style="font-size:11px;font-weight:600;color:${T.greenSoft};letter-spacing:.3px;">DISCUSSION · LINE ${this.line}</span>`;
      box.appendChild(head);
      for (const c of this.comments) {
        const rc = ROLE_COLORS[c.author_role] ?? ROLE_COLORS.candidate;
        const item = document.createElement('div');
        item.style.cssText = 'display:flex;gap:10px;padding:12px 14px;';
        const when = timeAgo(c.created_at);
        item.innerHTML = `<div style="flex:0 0 26px;width:26px;height:26px;border-radius:50%;background:${rc.avBg};border:1.5px solid ${rc.color};display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:600;color:${rc.color};">${escapeHtml(initialsOf(c.author_name))}</div>
<div style="flex:1;"><div style="display:flex;align-items:center;gap:8px;margin-bottom:3px;"><span style="font-size:12px;font-weight:600;color:${T.textSoft};">${escapeHtml(c.author_name)}</span><span style="font-size:10px;color:${T.textFaint};">${c.author_role === 'interviewer' ? 'Interviewer' : 'Candidate'} · ${when}</span></div><div style="font-size:12.5px;color:${T.textBody};line-height:1.55;white-space:pre-wrap;">${escapeHtml(c.body)}</div></div>`;
        box.appendChild(item);
      }
      wrap.appendChild(box);
    }

    if (this.composerOpen) {
      const rc = ROLE_COLORS[this.meRole];
      const composer = document.createElement('div');
      composer.style.cssText = `margin:6px 20px 12px 54px;background:${T.bgCard};border:1px solid rgba(61,220,151,0.35);border-radius:10px;padding:12px 14px;box-shadow:0 0 0 1px rgba(61,220,151,0.06);font-family:${T.fontUI};`;
      const title = this.meRole === 'interviewer' ? 'LEAVE A NOTE' : 'ASK A QUESTION';
      const placeholder = this.meRole === 'interviewer' ? 'Comment on this line…' : 'Ask about this line…';
      const submitLabel = this.meRole === 'interviewer' ? 'Comment' : 'Send';
      composer.innerHTML = `
<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:9px;">
  <span style="font-size:11px;font-weight:600;color:${T.greenSoft};letter-spacing:.3px;">${title}</span>
  <button data-pl="close" style="background:none;border:none;color:${T.textFaint};cursor:pointer;font-size:16px;line-height:1;padding:0;">×</button>
</div>
<div style="display:flex;gap:10px;">
  <div style="flex:0 0 26px;width:26px;height:26px;border-radius:50%;background:${rc.avBg};border:1.5px solid ${rc.color};display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:600;color:${rc.color};">${escapeHtml(initialsOf(this.meName))}</div>
  <div style="flex:1;">
    <textarea data-pl="input" placeholder="${placeholder}" style="width:100%;height:58px;resize:none;background:${T.bg};border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:9px 11px;color:${T.textSoft};font-family:${T.fontUI};font-size:12.5px;line-height:1.5;outline:none;"></textarea>
    <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:8px;">
      <button data-pl="cancel" style="font-family:inherit;font-size:12px;color:${T.textMuted};background:none;border:1px solid rgba(255,255,255,0.1);padding:6px 12px;border-radius:7px;cursor:pointer;">Cancel</button>
      <button data-pl="submit" style="font-family:inherit;font-size:12px;font-weight:600;color:${T.greenDark};background:${T.green};border:none;padding:6px 14px;border-radius:7px;cursor:pointer;">${submitLabel}</button>
    </div>
  </div>
</div>`;
      const textarea = composer.querySelector('[data-pl="input"]') as HTMLTextAreaElement;
      const submit = () => {
        if (textarea.value.trim()) this.cb.onSubmit(this.line, textarea.value);
        else this.cb.onClose();
      };
      composer.querySelector('[data-pl="close"]')!.addEventListener('mousedown', (e) => {
        e.preventDefault();
        this.cb.onClose();
      });
      composer.querySelector('[data-pl="cancel"]')!.addEventListener('mousedown', (e) => {
        e.preventDefault();
        this.cb.onClose();
      });
      composer.querySelector('[data-pl="submit"]')!.addEventListener('mousedown', (e) => {
        e.preventDefault();
        submit();
      });
      textarea.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          submit();
        }
        if (e.key === 'Escape') this.cb.onClose();
      });
      setTimeout(() => textarea.focus(), 30);
      wrap.appendChild(composer);
    }
    return wrap;
  }

  ignoreEvent() {
    return true;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function timeAgo(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const h = Math.round(mins / 60);
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

const commentedGutter = new (class extends GutterMarker {
  elementClass = 'pl-line-commented-gutter';
})();

const setOverlayDecos = StateEffect.define<DecorationSet>();
const setGutterMarks = StateEffect.define<{ lines: number[] }>();

const overlayField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    value = value.map(tr.changes);
    for (const e of tr.effects) if (e.is(setOverlayDecos)) value = e.value;
    return value;
  },
  provide: (f) => EditorView.decorations.from(f),
});

const gutterMarksField = StateField.define<{ lines: number[] }>({
  create: () => ({ lines: [] }),
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setGutterMarks)) value = e.value;
    return value;
  },
});

const gutterMarksExt = gutterLineClass.compute([gutterMarksField, 'doc'], (state) => {
  const { lines } = state.field(gutterMarksField);
  const builder = new RangeSetBuilder<GutterMarker>();
  for (const n of [...lines].sort((a, b) => a - b)) {
    if (n >= 1 && n <= state.doc.lines) builder.add(state.doc.line(n).from, state.doc.line(n).from, commentedGutter);
  }
  return builder.finish();
});

export interface EditorHandle {
  applyRemote: (text: string) => void;
  setDoc: (text: string, lang: LangId) => void;
  getText: () => string;
}

export interface EditorProps {
  initialDoc: string;
  language: LangId;
  readOnly: boolean;
  meRole: Role;
  meName: string;
  comments: CommentRow[];
  highlights: HighlightRow[];
  composerLine: number | null;
  remoteCursors: RemoteCursor[];
  highlightMode: boolean;
  onChange: (text: string) => void;
  onCursor: (line: number, col: number) => void;
  onGutterClick: (line: number) => void;
  onRangeSelect: (line: number, colStart: number, colEnd: number) => void;
  onSubmitComment: (line: number, text: string) => void;
  onCloseComposer: () => void;
}

export const Editor = forwardRef<EditorHandle, EditorProps>(function Editor(props, ref) {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const langCompartment = useRef(new Compartment());
  const readOnlyCompartment = useRef(new Compartment());
  const propsRef = useRef(props);
  propsRef.current = props;
  // Bumped on a whole-document replace: mapping decorations through it would
  // collapse them onto position 0, so they're rebuilt instead.
  const [docEpoch, setDocEpoch] = useState(0);

  useImperativeHandle(ref, () => ({
    applyRemote(text: string) {
      const view = viewRef.current;
      if (!view) return;
      const diff = simpleDiff(view.state.doc.toString(), text);
      if (!diff) return;
      view.dispatch({ changes: diff, annotations: remoteAnnotation.of(true) });
    },
    setDoc(text: string, lang: LangId) {
      const view = viewRef.current;
      if (!view) return;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text },
        effects: [
          langCompartment.current.reconfigure(langExt(lang)),
          setOverlayDecos.of(Decoration.none),
        ],
        annotations: remoteAnnotation.of(true),
      });
      setDocEpoch((e) => e + 1);
    },
    getText() {
      return viewRef.current?.state.doc.toString() ?? '';
    },
  }));

  useEffect(() => {
    if (!host.current) return;
    const state = EditorState.create({
      doc: props.initialDoc,
      extensions: [
        lineNumbers({
          domEventHandlers: {
            mousedown(view, block) {
              const line = view.state.doc.lineAt(block.from).number;
              propsRef.current.onGutterClick(line);
              return true;
            },
          },
        }),
        history(),
        drawSelection(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        bracketMatching(),
        indentUnit.of('    '),
        keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
        plTheme,
        syntaxHighlighting(plHighlight, { fallback: true }),
        langCompartment.current.of(langExt(props.language)),
        readOnlyCompartment.current.of([EditorState.readOnly.of(props.readOnly), EditorView.editable.of(!props.readOnly)]),
        overlayField,
        gutterMarksField,
        gutterMarksExt,
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !update.transactions.some((tr) => tr.annotation(remoteAnnotation))) {
            propsRef.current.onChange(update.state.doc.toString());
          }
          if (update.selectionSet) {
            const head = update.state.selection.main.head;
            const line = update.state.doc.lineAt(head);
            propsRef.current.onCursor(line.number, head - line.from + 1);
          }
        }),
        EditorView.domEventHandlers({
          mouseup(_e, view) {
            const p = propsRef.current;
            if (!p.highlightMode) return false;
            const sel = view.state.selection.main;
            if (sel.empty) return false;
            const fromLine = view.state.doc.lineAt(sel.from);
            const toLine = view.state.doc.lineAt(sel.to);
            if (fromLine.number === toLine.number) {
              p.onRangeSelect(fromLine.number, sel.from - fromLine.from, sel.to - fromLine.from);
              view.dispatch({ selection: { anchor: sel.to } });
            }
            return false;
          },
        }),
      ],
    });
    const view = new EditorView({ state, parent: host.current });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    viewRef.current?.dispatch({ effects: langCompartment.current.reconfigure(langExt(props.language)) });
  }, [props.language]);
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: readOnlyCompartment.current.reconfigure([
        EditorState.readOnly.of(props.readOnly),
        EditorView.editable.of(!props.readOnly),
      ]),
    });
  }, [props.readOnly]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const doc = view.state.doc;
    type Deco = { from: number; to: number; deco: Decoration };
    const items: Deco[] = [];

    for (const h of props.highlights) {
      if (h.line_number < 1 || h.line_number > doc.lines) continue;
      const line = doc.line(h.line_number);
      if (h.col_start == null || h.col_end == null) {
        items.push({ from: line.from, to: line.from, deco: Decoration.line({ class: 'pl-line-pinned' }) });
      } else {
        const from = Math.min(line.from + h.col_start, line.to);
        const to = Math.min(line.from + h.col_end, line.to);
        if (to > from) items.push({ from, to, deco: Decoration.mark({ class: 'pl-tok-pinned' }) });
      }
    }

    // Remote cursors arrive as line/col; clamp them into this doc.
    for (const rc of props.remoteCursors) {
      if (rc.area !== 'editor' || rc.line == null) continue;
      const lineNo = Math.max(1, Math.min(rc.line, doc.lines));
      const line = doc.line(lineNo);
      const pos = Math.min(line.from + Math.max(0, (rc.col ?? 1) - 1), line.to);
      items.push({
        from: pos,
        to: pos,
        deco: Decoration.widget({ widget: new RemoteCursorWidget(rc.name, rc.color), side: 1 }),
      });
    }

    const byLine = new Map<number, CommentRow[]>();
    for (const c of props.comments) {
      if (!byLine.has(c.line_number)) byLine.set(c.line_number, []);
      byLine.get(c.line_number)!.push(c);
    }
    const threadLines = new Set<number>([...byLine.keys()]);
    if (props.composerLine != null) threadLines.add(props.composerLine);
    for (const n of threadLines) {
      if (n < 1 || n > doc.lines) continue;
      const line = doc.line(n);
      items.push({
        from: line.to,
        to: line.to,
        deco: Decoration.widget({
          widget: new ThreadWidget(n, byLine.get(n) ?? [], props.composerLine === n, props.meRole, props.meName, {
            onSubmit: (ln, text) => propsRef.current.onSubmitComment(ln, text),
            onClose: () => propsRef.current.onCloseComposer(),
          }),
          block: true,
          side: 1,
        }),
      });
    }

    const set = Decoration.set(
      items.map((it) => it.deco.range(it.from, it.to)),
      true
    );

    view.dispatch({
      effects: [setOverlayDecos.of(set), setGutterMarks.of({ lines: [...byLine.keys()] })],
    });
  }, [props.comments, props.highlights, props.composerLine, props.remoteCursors, props.meRole, props.meName, docEpoch]);

  return <div ref={host} style={{ height: '100%', minHeight: 0 }} />;
});
