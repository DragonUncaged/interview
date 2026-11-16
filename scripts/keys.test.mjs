/**
 * Connect-key invariants. The key is the only credential that yields a
 * candidate seat, so its shape is a security property, not a formatting one.
 *
 *   node --experimental-strip-types scripts/keys.test.mjs
 */
import assert from 'node:assert/strict';
import { generateRoomKey, isRoomKey, normalizeKey, ROOM_KEY_RE } from '../src/lib/keys.ts';

const SAMPLES = 200_000;
const ALPHABET_SIZE = 31;
const KEY_CHARS = 6;

// 1. every generated key is canonical
const counts = new Map();
for (let i = 0; i < SAMPLES; i++) {
  const key = generateRoomKey();
  assert.ok(isRoomKey(key), `non-canonical key generated: ${key}`);
  for (const c of key.slice(4)) counts.set(c, (counts.get(c) ?? 0) + 1);
}

// 2. the alphabet is drawn uniformly — a plain `byte % 31` would overweight the
//    first 8 symbols by ~12.5% because 256 % 31 = 8
assert.equal(counts.size, ALPHABET_SIZE, 'not every alphabet symbol was produced');
const expected = (SAMPLES * KEY_CHARS) / ALPHABET_SIZE;
for (const [symbol, n] of counts) {
  const drift = Math.abs(n - expected) / expected;
  assert.ok(drift < 0.05, `symbol ${symbol} drifted ${(drift * 100).toFixed(1)}% from uniform`);
}

// 3. normalizeKey absorbs the shapes people actually type
for (const [input, want] of [
  ['PXR-7K4QM2', 'PXR-7K4QM2'],
  ['pxr-7k4qm2', 'PXR-7K4QM2'],
  ['7K4QM2', 'PXR-7K4QM2'], // interviewer read out only the suffix
  ['PXR7K4QM2', 'PXR-7K4QM2'], // dash dropped on paste
  [' pxr - 7k4qm2 \n', 'PXR-7K4QM2'],
  ['', ''],
]) {
  assert.equal(normalizeKey(input), want, `normalizeKey(${JSON.stringify(input)})`);
}

// 4. anything with less entropy than generateRoomKey() produces is rejected
for (const bad of ['PXR-ABC', 'PXR-ABCDEFG', 'PXR-0O1IL2', 'PXR-abcdef', 'PXR-AAAA', '------', 'AAAAAA', null, undefined, 42]) {
  assert.ok(!isRoomKey(bad), `isRoomKey accepted ${JSON.stringify(bad)}`);
}

console.log(`ok — ${SAMPLES.toLocaleString()} keys canonical and uniform; ${ROOM_KEY_RE} enforced on both ends`);
