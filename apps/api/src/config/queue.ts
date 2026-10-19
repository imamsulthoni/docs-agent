import { Queue } from 'bullmq'
import { QUEUE_NAME, queueConnection } from './queue-connection.js'

let cached: Queue | null | undefined

/** Lazy index queue. Null when Redis is unreachable/unset (dev without infra). */
export function getDocumentQueue(): Queue | null {
  if (cached !== undefined) return cached
  const connection = queueConnection()
  if (!connection) {
    cached = null
    return cached
  }
  try {
    cached = new Queue(QUEUE_NAME, { connection })
    return cached
  } catch {
    cached = null
    return cached
  }
}
