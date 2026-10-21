import type { Context, MiddlewareHandler } from 'hono'
import {
  RATE_LIMIT_ATTACHMENT_PER_MIN,
  RATE_LIMIT_CHAT_PER_MIN,
  RATE_LIMIT_GLOBAL_PER_MIN,
  RATE_LIMIT_UPLOAD_PER_MIN,
  USER_ID_RE,
} from '../config.js'

const WINDOW_MS = 60_000

type Hits = Map<string, number[]>

export type RateLimitResult = {
  allowed: boolean
  /** Seconds until the oldest hit leaves the window (only when blocked). */
  retryAfter: number
}

/**
 * Pure fixed-window check, split out so tests can inject a clock. The store is
 * per limiter instance (in-process). Good enough for a single API instance;
 * switch to Redis when running more than one.
 */
export function checkRateLimit(
  hits: Hits,
  key: string,
  now: number,
  max: number,
  windowMs = WINDOW_MS,
): RateLimitResult {
  if (max <= 0) return { allowed: true, retryAfter: 0 }
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs)
  if (recent.length >= max) {
    const oldest = recent[0] ?? now
    hits.set(key, recent)
    return {
      allowed: false,
      retryAfter: Math.max(1, Math.ceil((windowMs - (now - oldest)) / 1000)),
    }
  }
  recent.push(now)
  hits.set(key, recent)
  return { allowed: true, retryAfter: 0 }
}

/**
 * Identity for throttling: server session wins (`u:<id>`), then a valid guest
 * fingerprint header, then IP. Header-only identity is spoofable by guests,
 * but for them it is the only stable handle; logged-in calls use the session.
 */
export function rateLimitKey(c: Context): string {
  const user = (
    c as unknown as { get(key: string): { id?: string } | null | undefined }
  ).get('user')
  if (user?.id) return `u:${user.id}`
  const fingerprint = c.req.header('x-user-id')?.trim()
  if (fingerprint && USER_ID_RE.test(fingerprint)) return fingerprint
  const ip =
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  return `ip:${ip}`
}

export function createRateLimit(options: {
  bucket: string
  max: number
  windowMs?: number
  now?: () => number
}): MiddlewareHandler {
  const hits: Hits = new Map()
  const now = options.now ?? (() => Date.now())
  const windowMs = options.windowMs ?? WINDOW_MS
  return async (c, next) => {
    const key = `${options.bucket}|${rateLimitKey(c)}`
    const result = checkRateLimit(hits, key, now(), options.max, windowMs)
    if (!result.allowed) {
      c.header('retry-after', String(result.retryAfter))
      return c.json(
        {
          detail: 'Rate limit exceeded. Try again shortly.',
          code: 'rate_limited',
        },
        429,
      )
    }
    await next()
  }
}

export const globalRateLimit = createRateLimit({
  bucket: 'global',
  max: RATE_LIMIT_GLOBAL_PER_MIN,
})
export const chatRateLimit = createRateLimit({
  bucket: 'chat',
  max: RATE_LIMIT_CHAT_PER_MIN,
})
export const uploadRateLimit = createRateLimit({
  bucket: 'upload',
  max: RATE_LIMIT_UPLOAD_PER_MIN,
})
export const attachmentRateLimit = createRateLimit({
  bucket: 'attachment',
  max: RATE_LIMIT_ATTACHMENT_PER_MIN,
})
