export interface AskInput {
  /** doc_id returned by POST /convert */
  docId: string
  question: string
  /** fp:<browser fingerprint>, see platform lib/identity.ts */
  userId: string
  /** doc:<docId>:s:<uuid> */
  sessionId: string
}

export interface Citation {
  page: number
  excerpt: string
  /** Set when the page came from a mentioned (non-active) document. */
  docId?: string
  documentName?: string
}

export interface AskResult {
  answer: string
  citations: Citation[]
  sessionId: string
}

export interface RetrievedPage {
  pageNumber: number
  content: string
  /** Source document; set for multi-document retrieval (active doc + mentions). */
  docId?: string
  documentName?: string
}

/** One uploaded file's processed text, injected as pure data into the prompt. */
export interface AttachmentContext {
  /** Sanitized file name; doubles as the citation label for the attachment. */
  name: string
  content: string
  /** Content was cut at the per-attachment char budget. */
  truncated?: boolean
  /** Text matched prompt-injection patterns; block is marked as data-only. */
  flagged?: boolean
}

/** One document available to the agent for a single turn. */
export interface DocumentScope {
  docId: string
  documentName: string
  /** The document the chat page is open on (vs. an `@` mention). */
  active?: boolean
}

export class NotImplementedError extends Error {
  readonly code = 'NOT_IMPLEMENTED'
  constructor(feature = 'agent') {
    super(`${feature} is not implemented yet`)
    this.name = 'NotImplementedError'
  }
}

export class NotConfiguredError extends Error {
  readonly code = 'NOT_CONFIGURED'
  readonly status = 503
  constructor(feature = 'rag') {
    super(`${feature} is not configured yet (missing env/infra)`)
    this.name = 'NotConfiguredError'
  }
}

export class IndexingError extends Error {
  readonly code = 'INDEXING'
  readonly status = 503
  constructor() {
    super('Document is still indexing, try again shortly')
    this.name = 'IndexingError'
  }
}
