/**
 * Small in-memory sliding-window limiter.
 *
 * Deliberately not backed by a store: the admin key is ~144 bits, so this is
 * defence in depth rather than the thing standing between an attacker and the
 * key. State lives per serverless instance, which means a determined attacker
 * spread across instances gets a higher effective ceiling — still far below
 * what brute force would need, and it costs no extra infrastructure.
 */
type Window = { count: number; resetAt: number };

const buckets = new Map<string, Window>();

// Bound the map so a flood of distinct keys can't grow it without limit.
const MAX_TRACKED = 10_000;

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
};

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number
): RateLimitResult {
  const now = Date.now();
  const existing = buckets.get(key);

  if (!existing || existing.resetAt <= now) {
    if (buckets.size >= MAX_TRACKED) evictExpired(now);
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1, retryAfterSeconds: 0 };
  }

  existing.count++;
  const retryAfterSeconds = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
  if (existing.count > limit) {
    return { allowed: false, remaining: 0, retryAfterSeconds };
  }
  return {
    allowed: true,
    remaining: limit - existing.count,
    retryAfterSeconds,
  };
}

function evictExpired(now: number) {
  for (const [k, v] of buckets) {
    if (v.resetAt <= now) buckets.delete(k);
  }
  // Still full of live windows? Drop the oldest insertions to stay bounded.
  if (buckets.size >= MAX_TRACKED) {
    let toDrop = Math.ceil(MAX_TRACKED / 10);
    for (const k of buckets.keys()) {
      buckets.delete(k);
      if (--toDrop <= 0) break;
    }
  }
}

/** Best-effort client identity for limiting. Vercel populates x-forwarded-for. */
export function clientKey(req: Request, salt: string): string {
  const fwd = req.headers.get("x-forwarded-for");
  const ip = fwd?.split(",")[0].trim() || "unknown";
  return `${salt}:${ip}`;
}

/** Exposed for tests, which need a clean slate between cases. */
export function resetRateLimits() {
  buckets.clear();
}
