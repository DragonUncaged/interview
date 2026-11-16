import { LANGS } from './langs';
import type { LangId } from './types';

/** A one-line hint for the few run errors we can recognise reliably. */
export function errorHint(error: string, lang: LangId): string | null {
  if (error.includes('No solution function found')) {
    if (LANGS[lang].mode !== 'function') return null;
    return lang === 'python'
      ? 'Define a top-level function (e.g. `def solve(nums):`) or a `Solution` class with a method.'
      : 'Define a top-level function (e.g. `function solve(nums) {}` or `const solve = (nums) => {}`).';
  }
  if (/time limit exceeded/i.test(error)) {
    return 'Your code took too long. Look for an infinite loop or a slower-than-needed algorithm.';
  }
  if (/out of memory|memory limit/i.test(error)) {
    return 'Your code used too much memory. Check for unbounded data structures or recursion.';
  }
  return null;
}
