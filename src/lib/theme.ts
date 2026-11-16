export const T = {
  bg: '#0a0e15',
  bgPanel: '#0c1119',
  bgCard: '#0d121c',
  bgHeader: 'linear-gradient(180deg,#0d1220,#0b1018)',
  bgMenu: '#141b28',
  border: 'rgba(255,255,255,0.07)',
  borderSoft: 'rgba(255,255,255,0.06)',
  borderInput: 'rgba(255,255,255,0.1)',
  text: '#e7ecf3',
  textSoft: '#cfd6e2',
  textBody: '#b3bccb',
  textMuted: '#8a94a6',
  textFaint: '#5f6b7e',
  textGutter: '#3a4454',
  green: '#3ddc97',
  greenSoft: '#7be9b8',
  greenDark: '#04120b',
  blue: '#5b8cff',
  blueSoft: '#9db8ff',
  yellow: '#ffd479',
  red: '#ff5c6c',
  redSoft: '#ff8a95',
  code: {
    kw: '#ff7ab6',
    fn: '#82aaff',
    ty: '#7fdbca',
    punc: '#7d8799',
    txt: '#d6deeb',
    cm: '#5f6b7e',
    str: '#ecc48d',
    num: '#f78c6c',
  },
  fontUI: 'var(--font-ui), system-ui, sans-serif',
  fontMono: 'var(--font-mono), ui-monospace, monospace',
  fontHand: 'var(--font-hand), cursive',
} as const;

export const ROLE_COLORS = {
  interviewer: { color: T.green, avBg: '#183a2c', soft: T.greenSoft },
  candidate: { color: T.blue, avBg: '#1a2947', soft: T.blueSoft },
} as const;

export function initials(name: string): string {
  return (name || '')
    .split(' ')
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

export function diffMeta(d: string) {
  const u = (d || '').toLowerCase();
  if (u.startsWith('med')) return { color: T.yellow, bg: 'rgba(255,212,121,0.12)', border: 'rgba(255,212,121,0.28)' };
  if (u.startsWith('hard')) return { color: T.redSoft, bg: 'rgba(255,138,149,0.12)', border: 'rgba(255,138,149,0.28)' };
  return { color: T.green, bg: 'rgba(61,220,151,0.12)', border: 'rgba(61,220,151,0.28)' };
}
