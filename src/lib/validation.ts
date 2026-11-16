// Shared by client and server (no server-only import).

export const MAX_TEST_FIELD_LEN = 10_000;
export const MAX_TESTS = 12;

// Session and problem ids are Postgres uuids. Rejecting other shapes up front
// keeps attacker strings out of 22P02 driver errors and our logs.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

const DOMAIN_RE = /^[a-z0-9][-a-z0-9]*(\.[a-z0-9][-a-z0-9]*)+$/i;
const LOCAL_RE = /^[a-z0-9._+-]+$/i;

/** Why an email is invalid, or null when it is valid. */
export function emailError(email: string): string | null {
  if (!email) return 'Email is required';
  if (email.length > 254) return 'Email is too long (max 254 characters)';
  const parts = email.split('@');
  if (parts.length === 1) return 'Missing @ symbol';
  if (parts.length > 2) return 'Multiple @ symbols not allowed';
  const [local, domain] = parts;
  if (!local) return 'Nothing before the @';
  if (!domain) return 'Nothing after the @';
  if (local.length > 64) return 'Part before the @ is too long (max 64 characters)';
  if (!DOMAIN_RE.test(domain)) return 'Domain looks invalid';
  if (!LOCAL_RE.test(local)) return 'Part before the @ has invalid characters';
  return null;
}

export function isValidEmail(email: string): boolean {
  return emailError(email) === null;
}

export interface EmailValidationResult {
  email: string;
  valid: boolean;
  error?: string;
}

export function validateEmailList(text: string): EmailValidationResult[] {
  return text
    .split(/[,\s]+/)
    .map((e) => e.trim())
    .filter(Boolean)
    .map((email) => {
      const error = emailError(email);
      return { email, valid: !error, error: error ?? undefined };
    });
}
