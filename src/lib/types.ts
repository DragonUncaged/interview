export type Role = 'interviewer' | 'candidate';
export type Difficulty = 'easy' | 'medium' | 'hard';
export type LangId = 'python' | 'javascript' | 'java' | 'cpp' | 'go';
export type SessionStatus = 'scheduled' | 'live' | 'completed';

export interface Profile {
  id: string;
  display_name: string | null;
  email: string | null;
  is_anonymous: boolean;
}

export interface Problem {
  id: string;
  owner_id: string | null;
  number: number | null;
  title: string;
  difficulty: Difficulty;
  description: string;
  follow_up: string | null;
  tags: string[];
  starter_code: Partial<Record<LangId, string>>;
  visible_tests: { input: string; expected: string }[];
}

// A bank problem's hints and hidden tests never pass through the browser: the server
// copies them from the database when a session is created or a problem is assigned.
export const PROBLEM_COLUMNS =
  'id,owner_id,number,title,difficulty,description,follow_up,tags,starter_code,visible_tests,created_at';

export interface Session {
  id: string;
  created_by: string;
  room_key: string;
  status: SessionStatus;
  candidate_name: string;
  candidate_role_label: string;
  problem_id: string | null;
  problem_number: number | null;
  problem_title: string;
  difficulty: Difficulty;
  description: string;
  follow_up: string | null;
  tags: string[];
  language: LangId;
  code: Partial<Record<LangId, string>>;
  starter_code: Partial<Record<LangId, string>>;
  started_at: string | null;
  ended_at: string | null;
  created_at: string;
}

// pl_sessions.hints is revoked from clients (read hints via pl_session_hints), so
// select('*') is denied: always select these columns.
export const SESSION_COLUMNS =
  'id,created_by,room_key,status,candidate_name,candidate_role_label,problem_id,problem_number,problem_title,' +
  'difficulty,description,follow_up,tags,language,code,starter_code,started_at,ended_at,created_at';

/** One entry from pl_session_hints; text is null until the candidate reveals it. */
export interface HintView {
  index: number;
  revealed: boolean;
  text: string | null;
}

export interface Participant {
  id: string;
  session_id: string;
  user_id: string;
  role: Role;
  display_name: string;
  color: string;
  joined_at: string;
}

export interface TestCaseRow {
  id: string;
  session_id: string;
  position: number;
  input: string;
  expected: string;
  hidden: boolean;
}

export interface CommentRow {
  id: string;
  session_id: string;
  line_number: number;
  author_id: string;
  author_name: string;
  author_role: Role;
  body: string;
  created_at: string;
}

export interface HighlightRow {
  id: string;
  session_id: string;
  line_number: number;
  col_start: number | null;
  col_end: number | null;
  created_by: string;
}

export interface CaseResult {
  position: number;
  input: string;
  expected: string;
  got: string;
  pass: boolean;
  stderr?: string;
}

export interface RunSummary {
  passed: number;
  total: number;
  hiddenPassed: number;
  hiddenTotal: number;
  timeMs: number;
}

export interface RunRow {
  id: string;
  session_id: string;
  triggered_by: string;
  language: LangId;
  status: 'done' | 'error';
  summary: RunSummary;
  visible_results: CaseResult[];
  error: string | null;
  created_at: string;
}

export type WbTool = 'pen' | 'rect' | 'circle' | 'arrow' | 'text' | 'sticky' | 'eraser';

export interface WbObject {
  id: string;
  kind: 'stroke' | 'rect' | 'circle' | 'arrow' | 'text' | 'sticky';
  color: string;
  authorId: string;
  points?: [number, number][];
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  text?: string;
}

export const RUBRIC_CRITERIA = ['Problem solving', 'Code quality', 'Communication', 'Edge cases'] as const;
