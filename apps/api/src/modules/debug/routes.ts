import { Hono } from 'hono'
import { DOC_ID_RE } from '../../config.js'
import { getDocStatus } from '../documents/store.js'
import { getIndexDebugReport } from './service.js'

const debugRoutes = new Hono()

/** Document indexing status */
debugRoutes.get('/status/:docId', async (c) => {
  const docId = c.req.param('docId')
  if (!DOC_ID_RE.test(docId)) return c.json({ detail: 'Invalid doc_id.' }, 400)
  const status = await getDocStatus(docId)
  if (!status.found) {
    return c.json({ docId, found: false, indexed: false, pages: 0, summary: null })
  }
  return c.json({
    docId,
    found: true,
    indexed: status.isProcessed,
    pages: status.pages,
    summary: status.summary,
  })
})

/**
 * Debug endpoint: tells you WHICH indexing stage is stuck.
 * GET /v1/debug/:docId → { doc, queue, env }
 * - doc: row in Postgres (missing = upsertPendingDoc never ran or failed)
 * - queue: BullMQ job state (null when Redis unavailable; failedReason = worker error)
 * - env: which infra is configured
 */
debugRoutes.get('/debug/:docId', async (c) => {
  const docId = c.req.param('docId')
  if (!DOC_ID_RE.test(docId)) return c.json({ detail: 'Invalid doc_id.' }, 400)
  return c.json(await getIndexDebugReport(docId))
})

export { debugRoutes }
