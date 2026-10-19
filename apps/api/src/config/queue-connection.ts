import { REDIS_URL } from '../config.js'

export const QUEUE_NAME = 'documents'

/** Parsed once for BullMQ/IORedis. Null-safe: callers handle missing Redis. */
export function queueConnection(): { host: string; port: number } | null {
  try {
    const u = new URL(REDIS_URL)
    return { host: u.hostname || '127.0.0.1', port: Number(u.port || 6379) }
  } catch {
    return null
  }
}
