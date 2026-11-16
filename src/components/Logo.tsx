import { T } from '@/lib/theme';

export function Logo({ size = 15, fontSize = 14, spacing = 3 }: { size?: number; fontSize?: number; spacing?: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: size < 16 ? 10 : 12 }}>
      <div
        style={{
          width: size,
          height: size,
          background: T.green,
          transform: 'rotate(45deg)',
          borderRadius: Math.max(3, Math.round(size / 5)),
          boxShadow: '0 0 14px rgba(61,220,151,0.65)',
        }}
      />
      <span style={{ fontWeight: 700, letterSpacing: spacing, fontSize }}>PARALLEL</span>
    </div>
  );
}
