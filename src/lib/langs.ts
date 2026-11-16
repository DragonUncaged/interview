import type { LangId } from './types';

export interface LangMeta {
  id: LangId;
  label: string;
  file: string;
  piston: { language: string; version: string };
  /** 'function' → harness calls the candidate's function per case.
   *  'stdio'    → program gets the raw input line on stdin, stdout is compared. */
  mode: 'function' | 'stdio';
  statusLabel: string;
}

export const LANGS: Record<LangId, LangMeta> = {
  python: {
    id: 'python',
    label: 'Python',
    file: 'solution.py',
    piston: { language: 'python', version: '*' },
    mode: 'function',
    statusLabel: 'Python 3',
  },
  javascript: {
    id: 'javascript',
    label: 'JavaScript',
    file: 'solution.js',
    piston: { language: 'javascript', version: '*' },
    mode: 'function',
    statusLabel: 'Node.js',
  },
  java: {
    id: 'java',
    label: 'Java',
    file: 'Main.java',
    piston: { language: 'java', version: '*' },
    mode: 'stdio',
    statusLabel: 'Java',
  },
  cpp: {
    id: 'cpp',
    label: 'C++',
    file: 'solution.cpp',
    piston: { language: 'c++', version: '*' },
    mode: 'stdio',
    statusLabel: 'C++ (GCC)',
  },
  go: {
    id: 'go',
    label: 'Go',
    file: 'solution.go',
    piston: { language: 'go', version: '*' },
    mode: 'stdio',
    statusLabel: 'Go',
  },
};

export const LANG_IDS = Object.keys(LANGS) as LangId[];

export const DEFAULT_STARTERS: Record<LangId, string> = {
  python: `from typing import List

class Solution:
    def solve(self, nums: List[int]) -> List[int]:
        # your code here
        pass
`,
  javascript: `function solve(nums) {
  // your code here
}
`,
  java: `import java.util.*;

// stdin/stdout mode: read the input line, print the answer.
class Main {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        String line = sc.hasNextLine() ? sc.nextLine() : "";
        // parse line, solve, print result
    }
}
`,
  cpp: `#include <bits/stdc++.h>
using namespace std;

// stdin/stdout mode: read the input line, print the answer.
int main() {
    string line;
    getline(cin, line);
    // parse line, solve, print result
    return 0;
}
`,
  go: `package main

import (
\t"bufio"
\t"fmt"
\t"os"
)

// stdin/stdout mode: read the input line, print the answer.
func main() {
\treader := bufio.NewReader(os.Stdin)
\tline, _ := reader.ReadString('\\n')
\t_ = line
\tfmt.Println()
}
`,
};
