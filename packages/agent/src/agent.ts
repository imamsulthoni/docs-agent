import {
  Agent,
  type AnyTool,
  type CompletionModel,
  type MemoryStore,
} from '@anvia/core'
import { defaultModel } from './providers/openai.js'
import { QA_INSTRUCTIONS } from './prompts/qa-instructions.js'
import { SAFETY_INSTRUCTIONS } from './prompts/safety-instructions.js'
import { docGuardrails } from './prompts/guardrails.js'
import type { DocumentScope } from './types.js'

export interface CreateDocAgentOptions {
  docId: string
  model?: CompletionModel
  /** Summary of the active document (mentions are not summarized). */
  summary?: string | null
  /** Documents this turn may use: the active one plus validated mentions. */
  documents?: DocumentScope[]
  tools?: AnyTool[]
  additionalInstructions?: string[]
  memory?: MemoryStore
  maxTurns?: number
}

const DEFAULT_MAX_TURNS = 5

function documentSection(documents: DocumentScope[] | undefined): string[] {
  if (!documents || documents.length === 0) return []
  const lines = documents.map(
    (d) => `- ${d.documentName} (docId ${d.docId})${d.active ? ' [active]' : ' [mentioned]'}`,
  )
  return [
    'Documents available in this turn (the active document plus any the user mentioned):',
    ...lines,
  ]
}

/**
 * Doc-QA agent factory (cermin createAgent referensi, API v1):
 * instructions QA + safety, tools dokumen per-request, guardrails enforce,
 * memory per session. Model default dari providers/openai.
 */
export function createDocAgent(opts: CreateDocAgentOptions) {
  const instructions = [
    QA_INSTRUCTIONS,
    SAFETY_INSTRUCTIONS,
    ...documentSection(opts.documents),
    ...(opts.summary ? [`Active document summary:\n${opts.summary}`] : []),
    ...(opts.additionalInstructions ?? []),
  ].join('\n')

  return new Agent({
    id: `doc-${opts.docId}`,
    model: opts.model ?? defaultModel(),
    instructions,
    maxTurns: opts.maxTurns ?? DEFAULT_MAX_TURNS,
    tools: opts.tools ?? [],
    guardrails: docGuardrails,
    ...(opts.memory ? { memory: { store: opts.memory } } : {}),
  })
}
