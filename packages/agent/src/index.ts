export * from './markdown.js'
export * from './types.js'
export * from './agent.js'
export * from './tools/index.js'
export * from './prompts/index.js'
export * from './providers/index.js'

import { NotImplementedError } from './types.js'
import type { AskInput, AskResult } from './types.js'

/**
 * RAG over a converted document. The heavy lifting (Prisma + Qdrant +
 * model + memory) lives in apps/api so this package stays light and
 * buildable without infra. apps/api/src/modules/chat/service.ts
 * implements the real path; this stub keeps the shared contract.
 */
export async function askDoc(_input: AskInput): Promise<AskResult> {
  throw new NotImplementedError('askDoc (call the API route instead)')
}

/** Generate QA test cases from a converted document. Stub. */
export async function generateQa(_docId: string): Promise<never> {
  throw new NotImplementedError('generateQa')
}
