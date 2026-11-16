// Connect keys look like PXR-7K4QM2: 6 symbols from a 31-char alphabet with no
// 0/O/1/I/L, about 887M combinations.
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const KEY_LEN = 6;

// A key is the only credential that yields a candidate seat, so create and join
// both enforce this exact shape.
export const ROOM_KEY_RE = new RegExp(`^PXR-[${ALPHABET}]{${KEY_LEN}}$`);

export function isRoomKey(key: unknown): key is string {
  return typeof key === 'string' && ROOM_KEY_RE.test(key);
}

export function generateRoomKey(): string {
  // Rejection sampling: 256 % 31 != 0, so `byte % 31` alone would bias the
  // first symbols of the alphabet.
  const limit = 256 - (256 % ALPHABET.length);
  const buf = new Uint8Array(12);
  let s = '';
  while (s.length < KEY_LEN) {
    crypto.getRandomValues(buf);
    for (const b of buf) {
      if (b >= limit) continue;
      s += ALPHABET[b % ALPHABET.length];
      if (s.length === KEY_LEN) break;
    }
  }
  return `PXR-${s}`;
}

/** Accept what people actually type: lowercase, spaces, a missing dash, or just the 6-char suffix. */
export function normalizeKey(key: string): string {
  const s = key.replace(/\s+/g, '').toUpperCase();
  if (!s) return '';
  return `PXR-${s.replace(/^PXR/, '').replace(/^-+/, '')}`;
}
