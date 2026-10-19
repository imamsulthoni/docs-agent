import { getDocumentQueue } from '../../config/queue.js'
import { prisma } from '../../utils/prisma.js'

export async function getDebugDocument(docId: string): Promise<unknown> {
  try {
    return await prisma.document.findUnique({
      where: { id: docId },
      select: {
        id: true,
        name: true,
        markdownUrl: true,
        isProcessed: true,
        createdAt: true,
        _count: { select: { pages: true } },
      },
    })
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
}

export async function getDebugQueue(docId: string): Promise<unknown> {
  try {
    const queue = getDocumentQueue()
    if (!queue) {
      return {
        available: false,
        hint: 'Redis queue unavailable — check REDIS_URL and that Redis is running',
      }
    }
    const jobs = await queue.getJobs(
      ['waiting', 'active', 'delayed', 'failed', 'completed'],
      0,
      20,
    )
    const mine = jobs.filter((job) => (job.data.docId ?? job.data.id) === docId)
    return {
      available: true,
      jobs: await Promise.all(
        mine.map(async (job) => ({
          id: job.id,
          name: job.name,
          state: await job.getState().catch(() => 'unknown'),
          attemptsMade: job.attemptsMade,
          failedReason: job.failedReason ?? null,
          timestamp: job.timestamp,
          processedOn: job.processedOn ?? null,
          finishedOn: job.finishedOn ?? null,
        })),
      ),
    }
  } catch (err) {
    return { available: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export function getDebugEnvironment(): {
  redisUrl: string
  qdrantUrl: string
  hasOpenAI: boolean
  embeddingModel: string
} {
  return {
    redisUrl: (process.env.REDIS_URL ?? '').replace(/:[^:@/]+@/, ':***@'),
    qdrantUrl: process.env.QDRANT_URL ?? '',
    hasOpenAI: Boolean(process.env.OPENAI_API_KEY),
    embeddingModel: process.env.EMBEDDING_MODEL ?? 'Xenova/all-MiniLM-L6-v2',
  }
}

export async function getIndexDebugReport(docId: string): Promise<{
  docId: string
  doc: unknown
  queue: unknown
  env: ReturnType<typeof getDebugEnvironment>
  hint: string
}> {
  const [doc, queue] = await Promise.all([
    getDebugDocument(docId),
    getDebugQueue(docId),
  ])
  return {
    docId,
    doc,
    queue,
    env: getDebugEnvironment(),
    hint: 'doc=null → POST /convert never recorded (check api logs [index:enqueue]). queue.jobs empty → job lost before Redis. failedReason set → worker error at that stage. doc.isProcessed=false + job completed → db-write failed.',
  }
}
