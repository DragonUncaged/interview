import 'server-only';

// In-memory sliding window. Only correct on a single instance: on serverless
// each instance keeps its own map, so the real limit is max × instances. Set
// UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN to share one counter.
const buckets = new Map<string, number[]>();

function rateLimitLocal(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const hits = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  const allowed = hits.length < max;
  if (allowed) hits.push(now);
  buckets.set(key, hits);
  if (buckets.size > 10_000) {
    for (const [k, v] of buckets) if (v.every((t) => now - t >= windowMs)) buckets.delete(k);
  }
  return allowed;
}

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const useRedis = Boolean(UPSTASH_URL && UPSTASH_TOKEN);

/** Fixed-window counter in Redis. Returns null when the backend is unreachable. */
async function rateLimitRedis(key: string, max: number, windowMs: number): Promise<boolean | null> {
  // The window slot is part of the key, so a bucket expires with its window
  // even if PEXPIRE is lost.
  const redisKey = `rl:${key}:${Math.floor(Date.now() / windowMs)}`;
  try {
    const res = await fetch(`${UPSTASH_URL}/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${UPSTASH_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify([
        ['INCR', redisKey],
        ['PEXPIRE', redisKey, String(windowMs), 'NX'],
      ]),
      cache: 'no-store',
      signal: AbortSignal.timeout(1_500),
    });
    if (!res.ok) return null;
    const out = (await res.json()) as { result?: unknown }[];
    const count = Number(out?.[0]?.result);
    return Number.isFinite(count) ? count <= max : null;
  } catch {
    return null;
  }
}

/** Allow this hit? Fails open to the in-memory window if Redis is down. */
export async function rateLimit(key: string, max: number, windowMs: number): Promise<boolean> {
  if (useRedis) {
    const allowed = await rateLimitRedis(key, max, windowMs);
    if (allowed !== null) return allowed;
    console.warn('Rate limit backend unavailable, falling back to in-memory window');
  }
  return rateLimitLocal(key, max, windowMs);
}

export function clientIp(req: Request): string {
  // x-real-ip is set by the proxy on every request, so the client can't spoof it.
  const real = req.headers.get('x-real-ip')?.trim();
  if (real) return real;
  // Clients can prepend to x-forwarded-for; only the last entry comes from our proxy.
  const ips = (req.headers.get('x-forwarded-for') ?? '')
    .split(',')
    .map((ip) => ip.trim())
    .filter(Boolean);
  return ips[ips.length - 1] ?? 'unknown';
}
