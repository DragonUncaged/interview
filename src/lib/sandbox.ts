import 'server-only';
import { randomUUID } from 'node:crypto';
import { LANGS } from './langs';
import { MAX_TEST_FIELD_LEN } from './validation';
import type { CaseResult, LangId } from './types';

// Candidate code never runs on our server: it goes to Wandbox by default, or to
// a self-hosted Piston when PISTON_URL is set.
//
// Invariants:
// - Only inputs enter the sandbox. Expected outputs stay here and are compared
//   in Node, so candidate code can never read them.
// - Callers run visible and hidden cases in separate processes, so a hidden
//   input can't leak through a visible case's output.
// - The results line is tagged with a per-run random sentinel so candidate
//   output can't forge it.

const WANDBOX_URL = () => process.env.WANDBOX_URL || 'https://wandbox.org/api';
const WANDBOX_COMPILERS: Record<LangId, string> = {
  python: 'cpython-3.13.8',
  javascript: 'nodejs-20.17.0',
  java: 'openjdk-jdk-22+36',
  cpp: 'gcc-13.2.0',
  go: 'go-1.23.2',
};

interface ExecResult {
  stdout: string;
  stderr: string;
  compileError: string;
  killed: boolean;
}

async function execWandbox(langId: LangId, code: string, stdin: string): Promise<ExecResult> {
  const res = await fetch(`${WANDBOX_URL()}/compile.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ compiler: WANDBOX_COMPILERS[langId], code, stdin }),
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) throw new Error(`sandbox error (${res.status})`);
  const j = (await res.json()) as {
    status?: string;
    signal?: string;
    program_output?: string;
    program_error?: string;
    compiler_error?: string;
  };
  return {
    stdout: j.program_output ?? '',
    stderr: j.program_error ?? '',
    compileError: j.compiler_error ?? '',
    killed: Boolean(j.signal),
  };
}

async function execPiston(langId: LangId, code: string, stdin: string): Promise<ExecResult> {
  const meta = LANGS[langId];
  const res = await fetch(`${process.env.PISTON_URL}/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      language: meta.piston.language,
      version: meta.piston.version,
      files: [{ name: meta.file, content: code }],
      stdin,
      run_timeout: 5000,
      compile_timeout: 10000,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`sandbox error (${res.status})`);
  const j = (await res.json()) as {
    run?: { stdout: string; stderr: string; signal: string | null };
    compile?: { stderr: string; code: number };
  };
  return {
    stdout: j.run?.stdout ?? '',
    stderr: j.run?.stderr ?? '',
    compileError: j.compile && j.compile.code !== 0 ? (j.compile.stderr ?? '') : '',
    killed: j.run?.signal === 'SIGKILL',
  };
}

function execute(langId: LangId, code: string, stdin = ''): Promise<ExecResult> {
  return process.env.PISTON_URL ? execPiston(langId, code, stdin) : execWandbox(langId, code, stdin);
}

/** Compare outputs as JSON when possible (whitespace-insensitive, 1.0 == 1), else as trimmed text. */
function normalize(s: string): string {
  const t = (s ?? '').trim();
  try {
    return JSON.stringify(JSON.parse(t), (_k, v) => (typeof v === 'number' ? Number(v) : v));
  } catch {
    return t;
  }
}

interface RawCase {
  position: number;
  input: string;
  expected: string;
  hidden: boolean;
}

// The harness reports raw output only; the verdict is decided in Node.
interface RawCell {
  got: string;
  stderr: string;
}

function pythonHarness(code: string, inputs: string[], sentinel: string, entryHint?: string): string {
  const inputsJson = JSON.stringify(inputs);
  return `${code}

# ---- PARALLEL test harness (appended) ----
import json as __pl_json, traceback as __pl_tb

def __pl_resolve():
    g = globals()
    hint = ${entryHint ? JSON.stringify(entryHint) : 'None'}
    sol = g.get('Solution')
    if sol is not None:
        inst = sol()
        if hint and callable(getattr(inst, hint, None)):
            return getattr(inst, hint)
        names = [m for m in type(inst).__dict__ if not m.startswith('_') and callable(getattr(inst, m, None))]
        if names:
            return getattr(inst, names[0])
    if hint and callable(g.get(hint)):
        return g[hint]
    for k, v in list(g.items()):
        if callable(v) and not k.startswith('_') and getattr(v, '__module__', None) == '__main__' and k != 'Solution':
            return v
    raise RuntimeError('No solution function found — define a function or a Solution class method.')

def __pl_main():
    inputs = __pl_json.loads(${JSON.stringify(inputsJson)})
    out = []
    try:
        fn = __pl_resolve()
    except Exception as e:
        print('${sentinel}' + __pl_json.dumps({'error': str(e), 'results': []}))
        return
    for raw in inputs:
        r = {'got': '', 'stderr': ''}
        try:
            kwargs = eval('dict(' + raw + ')', {'__builtins__': __builtins__})
            got = fn(**kwargs)
            r['got'] = __pl_json.dumps(got, default=str)
        except Exception:
            r['stderr'] = __pl_tb.format_exc(limit=3)
        out.append(r)
    print('${sentinel}' + __pl_json.dumps({'results': out}))

__pl_main()
`;
}

/** Top-level declaration names, in source order. A heuristic: false positives
 *  are harmless because the harness checks each name with typeof. */
function extractEntryNames(code: string): string[] {
  const names: string[] = [];
  const re = /(?:^|\n)\s*(?:export\s+)?(?:async\s+)?(?:function\*?|const|let|var|class)\s+([A-Za-z_$][\w$]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) names.push(m[1]);
  return [...new Set(names)];
}

function jsHarness(code: string, inputs: string[], sentinel: string, entryHint?: string): string {
  const inputsJson = JSON.stringify(inputs);
  const names = extractEntryNames(code);
  // Concatenate rather than eval: const/let/class bindings made inside eval are
  // not visible afterwards, so arrow-function solutions would be missed.
  const collect = names
    .map((n) => `  try { if (typeof ${n} === 'function') __pl_fns.push([${JSON.stringify(n)}, ${n}]); } catch (e) {} `)
    .join('\n');
  return `${code}

// ---- PARALLEL test harness (appended) ----
const __pl_fns = [];
${collect}
const __pl_hint = ${entryHint ? JSON.stringify(entryHint) : 'null'};
let __pl_fn = null;
if (__pl_hint) { const h = __pl_fns.find(([n]) => n === __pl_hint); if (h) __pl_fn = h[1]; }
if (!__pl_fn && __pl_fns.length) __pl_fn = __pl_fns[__pl_fns.length - 1][1];

function __pl_parseArgs(input) {
  const parts = [];
  let depth = 0, cur = '', inStr = null, esc = false;
  for (const ch of input) {
    if (inStr) {
      cur += ch;
      if (esc) { esc = false; continue; }
      if (ch === '\\\\') { esc = true; continue; }
      if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === '"' || ch === "'") { inStr = ch; cur += ch; continue; }
    if (ch === '[' || ch === '{' || ch === '(') depth++;
    if (ch === ']' || ch === '}' || ch === ')') depth--;
    if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) parts.push(cur);
  return parts.map((p) => {
    const eq = p.indexOf('=');
    const expr = eq >= 0 ? p.slice(eq + 1) : p;
    return (0, eval)('(' + expr + ')');
  });
}

const __pl_inputs = JSON.parse(${JSON.stringify(inputsJson)});
const __pl_out = [];
if (!__pl_fn) {
  console.log('${sentinel}' + JSON.stringify({ error: 'No solution function found — define a top-level function.', results: [] }));
} else {
  for (const raw of __pl_inputs) {
    const r = { got: '', stderr: '' };
    try {
      const args = __pl_parseArgs(raw);
      const got = __pl_fn(...args);
      r.got = JSON.stringify(got === undefined ? null : got);
    } catch (e) {
      r.stderr = String(e && e.stack ? e.stack.split('\\n').slice(0, 4).join('\\n') : e);
    }
    __pl_out.push(r);
  }
  console.log('${sentinel}' + JSON.stringify({ results: __pl_out }));
}
`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface RunOutcome {
  results: CaseResult[];
  error: string | null;
  timeMs: number;
}

/** Run candidate code against cases that are all visible or all hidden; never mix them. */
export async function runTests(
  langId: LangId,
  code: string,
  cases: RawCase[],
  entryHint?: string
): Promise<RunOutcome> {
  const started = Date.now();
  const meta = LANGS[langId];
  if (!cases.length) return { results: [], error: null, timeMs: 0 };

  const failAll = (error: string): RunOutcome => ({
    results: cases.map((c) => ({ position: c.position, input: c.input, expected: c.expected, got: '', pass: false })),
    error: error.slice(0, 4000),
    timeMs: Date.now() - started,
  });

  if (cases.some((c) => (c.input?.length ?? 0) > MAX_TEST_FIELD_LEN || (c.expected?.length ?? 0) > MAX_TEST_FIELD_LEN)) {
    return failAll(`A test case is larger than ${MAX_TEST_FIELD_LEN} characters`);
  }

  if (meta.mode === 'function') {
    const sentinel = `__PL_${randomUUID().replace(/-/g, '')}__`;
    const inputs = cases.map((c) => c.input);
    const program =
      langId === 'python'
        ? pythonHarness(code, inputs, sentinel, entryHint)
        : jsHarness(code, inputs, sentinel, entryHint);
    const r = await execute(langId, program);
    // Take the LAST sentinel line: the harness prints after the candidate's code runs.
    const line = [...r.stdout.split('\n')].reverse().find((l) => l.startsWith(sentinel));
    if (!line) {
      return failAll(
        r.compileError.trim() || r.stderr.trim() || (r.killed ? 'Time limit exceeded' : 'No output from program')
      );
    }
    let parsed: { error?: string; results: RawCell[] };
    try {
      parsed = JSON.parse(line.slice(sentinel.length));
    } catch {
      return failAll('Malformed sandbox output');
    }
    if (parsed.error) return failAll(parsed.error);
    return {
      results: cases.map((c, i) => {
        const cell = parsed.results[i];
        const got = cell?.got ?? '';
        return {
          position: c.position,
          input: c.input,
          expected: c.expected,
          got,
          pass: !cell?.stderr && got !== '' && normalize(got) === normalize(c.expected),
          stderr: cell?.stderr || undefined,
        };
      }),
      error: null,
      timeMs: Date.now() - started,
    };
  }

  // stdio mode: one sandbox run per case, input on stdin, compared against stdout.
  const results: CaseResult[] = [];
  let firstError: string | null = null;
  for (const c of cases) {
    const r = await execute(langId, code, c.input + '\n');
    if (r.compileError.trim()) return failAll(r.compileError);
    const err = r.stderr.trim();
    if (err && !firstError) firstError = err.slice(0, 4000);
    results.push({
      position: c.position,
      input: c.input,
      expected: c.expected,
      got: r.stdout.trim(),
      pass: !err && normalize(r.stdout) === normalize(c.expected),
      stderr: err || undefined,
    });
    if (cases.length > 1) await sleep(300);
  }
  return { results, error: firstError, timeMs: Date.now() - started };
}
