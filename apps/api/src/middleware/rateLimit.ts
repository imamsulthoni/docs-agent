import type { Context, Next } from 'hono'

const WINDOW_MS = 60_000
const MAX_REQUESTS = 120
const hits = new Map<string, number[]>()

/** Minimal fixed-window rate limiter (per user+IP). Move to Redis when multi-instance. */
export async function rateLimit(c: Context, next: Next) {
  const ip =
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ??
    'unknown'
  const user = c.req.header('x-user-id')?.trim() || 'anon'
  const key = `${user}|${ip}`
  const now = Date.now()
  const window = (hits.get(key) ?? []).filter((t) => now - t < WINDOW_MS)
  if (window.length >= MAX_REQUESTS) {
    return c.json({ detail: 'Rate limit exceeded.' }, 429)
  }
  window.push(now)
  hits.set(key, window)
  await next()
}
