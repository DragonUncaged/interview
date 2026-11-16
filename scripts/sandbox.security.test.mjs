/**
 * Sandbox security + correctness suite.
 *
 * The sandbox is the one place we deliberately execute attacker-controlled
 * code, so its guarantees are asserted here rather than assumed:
 *   1. hidden expected values never enter the candidate's process
 *   2. a candidate cannot forge a passing verdict
 *   3. ordinary solutions in every supported style still grade correctly
 *
 * Needs network access to the sandbox provider (Wandbox by default).
 *   npm run test:sandbox
 */
import { runTests } from '../src/lib/sandbox.ts';

let pass = 0;
let fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`${cond ? '  PASS' : '  FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (cond) pass++;
  else fail++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The public sandbox throttles bursts ("crun: clone: Resource temporarily
// unavailable"). Retrying keeps a provider hiccup from masquerading as a
// security pass — an assertion that only holds because nothing executed is
// worse than a red test.
const TRANSIENT = /Resource temporarily unavailable|OCI runtime|sandbox error \(5\d\d\)|ECONNRESET|timeout/i;

async function run(lang, code, cases, hint, attempts = 4) {
  for (let i = 0; i < attempts; i++) {
    const out = await runTests(lang, code, cases, hint);
    const stuck = out.error && TRANSIENT.test(out.error);
    if (!stuck) return out;
    const backoff = 4000 * (i + 1);
    console.log(`    (provider busy, retry ${i + 1}/${attempts - 1} in ${backoff / 1000}s)`);
    await sleep(backoff);
  }
  return runTests(lang, code, cases, hint);
}

/** A result set is only meaningful if the program actually ran. */
function executed(out) {
  return !(out.error && TRANSIENT.test(out.error));
}

// Mirrors how /api/run splits the groups: hidden cases never share a process
// with visible ones, and `expected` is compared in Node, never shipped inward.
const VISIBLE = [
  { position: 1, input: 'nums=[2,7,11,15], target=9', expected: '[0,1]', hidden: false },
  { position: 2, input: 'nums=[3,2,4], target=6', expected: '[1,2]', hidden: false },
];
const HIDDEN = [
  { position: 3, input: 'nums=[3,3], target=6', expected: '[0,1]', hidden: true },
  { position: 4, input: 'nums=[-1,-8,3,90], target=-9', expected: '[0,1]', hidden: true },
];

const PY_GOOD = `class Solution:
    def twoSum(self, nums, target):
        seen = {}
        for i, n in enumerate(nums):
            if target - n in seen:
                return [seen[target - n], i]
            seen[n] = i
        return []
`;

// Ignores its arguments and rummages through the interpreter for anything the
// harness might have left lying around — caller frames, its own source file.
const PY_EXFIL = `import sys, json
class Solution:
    def twoSum(self, nums, target):
        loot = []
        try:
            for depth in range(1, 8):
                f = sys._getframe(depth)
                loot.append({k: str(v)[:200] for k, v in f.f_locals.items()})
        except Exception:
            pass
        try:
            loot.append(open(__file__).read()[:4000])
        except Exception:
            pass
        try:
            loot.append(str(sys.argv))
        except Exception:
            pass
        return loot
`;

// Prints a results line of its own before the harness can print the real one.
const PY_FORGE = `print('__PL_RESULTS__' + '{"results":[{"got":"[0,1]","stderr":""},{"got":"[1,2]","stderr":""}]}')
class Solution:
    def twoSum(self, nums, target):
        return [9, 9]
`;

const JS_ARROW = `const twoSum = (nums, target) => {
  const seen = new Map();
  for (let i = 0; i < nums.length; i++) {
    if (seen.has(target - nums[i])) return [seen.get(target - nums[i]), i];
    seen.set(nums[i], i);
  }
};`;

const JS_DECL = `function twoSum(nums, target) {
  const seen = new Map();
  for (let i = 0; i < nums.length; i++) {
    if (seen.has(target - nums[i])) return [seen.get(target - nums[i]), i];
    seen.set(nums[i], i);
  }
}`;


async function main() {
  console.log('\n== correctness: ordinary solutions still grade ==');
  const good = await run('python', PY_GOOD, VISIBLE, 'twoSum');
  ok('python solution passes visible cases', good.results.every((r) => r.pass), good.error ?? '');
  await sleep(2500);

  const goodHidden = await run('python', PY_GOOD, HIDDEN, 'twoSum');
  ok('python solution passes hidden cases (separate process)', goodHidden.results.every((r) => r.pass), goodHidden.error ?? '');
  await sleep(2500);

  const decl = await run('javascript', JS_DECL, VISIBLE, 'twoSum');
  ok('js function declaration grades', decl.results.every((r) => r.pass), decl.error ?? '');
  await sleep(2500);

  const arrow = await run('javascript', JS_ARROW, VISIBLE, 'twoSum');
  ok('js const-arrow grades', arrow.results.every((r) => r.pass), arrow.error ?? '');
  await sleep(2500);

  console.log('\n== security: expected values must not be reachable from inside ==');
  const exfil = await run('python', PY_EXFIL, VISIBLE, 'twoSum');
  // Guard against a vacuous pass: if the provider never ran the code, the
  // "attacker got nothing" assertions below prove nothing.
  ok('exfiltration attempt actually executed (not a provider error)', executed(exfil), exfil.error ?? '');
  ok('exfiltration attempt fails its cases', exfil.results.every((r) => !r.pass));
  const dump = JSON.stringify(exfil.results.map((r) => r.got));
  // The visible expected values are already known to the candidate; the real
  // question is whether a HIDDEN one ever surfaces in a visible case's output.
  const hiddenLeak = HIDDEN.some((c) => dump.includes(c.expected) || dump.includes(c.input));
  ok('no HIDDEN expected/input reachable from the visible process', !hiddenLeak,
    hiddenLeak ? `LEAKED: ${dump.slice(0, 300)}` : 'process contains no hidden data');
  await sleep(600);

  const exfilHidden = await run('python', PY_EXFIL, HIDDEN, 'twoSum');
  ok('hidden-process exfil attempt actually executed', executed(exfilHidden), exfilHidden.error ?? '');
  const hdump = JSON.stringify(exfilHidden.results.map((r) => r.got));
  const expectedLeak = HIDDEN.some((c) => hdump.includes(c.expected));
  ok('hidden expected values absent even inside the hidden process', !expectedLeak,
    expectedLeak ? `LEAKED: ${hdump.slice(0, 300)}` : 'only inputs are present, never answers');
  await sleep(2500);

  console.log('\n== security: verdict forgery ==');
  const forged = await run('python', PY_FORGE, VISIBLE, 'twoSum');
  ok('forgery attempt actually executed', executed(forged), forged.error ?? '');
  ok('pre-printed sentinel line does not produce a pass', forged.results.every((r) => !r.pass),
    `got ${JSON.stringify(forged.results.map((r) => r.got))}`);

  console.log(`\n${fail === 0 ? 'ALL PASSED' : 'FAILURES PRESENT'} — ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
