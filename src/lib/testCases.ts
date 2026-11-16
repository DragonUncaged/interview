export interface TestPair {
  input: string;
  expected: string;
}

/** pl_test_cases rows: visible cases first, then hidden, positions 1..n. */
export function toTestRows(sessionId: string, visible: TestPair[], hidden: TestPair[]) {
  const row = (t: TestPair, position: number, isHidden: boolean) => ({
    session_id: sessionId,
    position,
    hidden: isHidden,
    input: t.input,
    expected: t.expected,
  });
  return [
    ...visible.map((t, i) => row(t, i + 1, false)),
    ...hidden.map((t, i) => row(t, visible.length + i + 1, true)),
  ];
}
