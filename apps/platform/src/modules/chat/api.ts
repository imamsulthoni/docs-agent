import type { UIMessage } from '@anvia/react'
import { API_URL } from '../../lib/api'
import { fpHeader } from '../../lib/identity'
import { forgetSession } from './sessions'

/** Max documents per message (server enforces the same limit). */
export const MAX_MENTIONS_PER_MESSAGE = 3

/** One `@` picker entry: an indexed document in any of the user's workspaces. */
export interface MentionableDocument {
  doc_id: string
  filename: string
  workspace_id: string
  workspace_name: string
  pages: number
}

/**
 * Cross-workspace mention candidates. `exclude` drops the document currently
 * open in the chat (it is already context).
 */
export async function fetchMentionableDocuments(
  query: string,
  exclude?: string,
  signal?: AbortSignal,
): Promise<MentionableDocument[]> {
  const params = new URLSearchParams({ q: query })
  if (exclude) params.set('exclude', exclude)
  const res = await fetch(
    `${API_URL}/v1/mentionable-documents?${params.toString()}`,
    { credentials: 'include', signal },
  )
  if (!res.ok) return []
  const body = (await res.json()) as { documents?: MentionableDocument[] }
  return body.documents ?? []
}

export interface DocStatus {
  docId: string
  /** False when the document row is gone (deleted or auto-expired by sweep). */
  found: boolean
  indexed: boolean
  pages: number
  summary: string | null
}

export async function fetchStatus(docId: string): Promise<DocStatus> {
  const res = await fetch(`${API_URL}/v1/status/${docId}`)
  if (!res.ok) throw new Error(`Could not load status (HTTP ${res.status}).`)
  return (await res.json()) as DocStatus
}

export async function fetchHistory(docId: string, sessionId: string): Promise<UIMessage[]> {
  // Credentialed so a logged-in user's history is read under `u:<id>`
  // (the server prefers the session over the guest fingerprint header).
  const res = await fetch(`${API_URL}/v1/chat/${docId}/${sessionId}`, {
    credentials: 'include',
    headers: fpHeader(),
  })
  if (res.status === 503) return []
  if (!res.ok) throw new Error(`Could not load history (HTTP ${res.status}).`)
  const body = (await res.json()) as { messages?: UIMessage[] }
  return body.messages ?? []
}

export async function deleteSession(docId: string, sessionId: string): Promise<void> {
  await fetch(`${API_URL}/v1/chat/${docId}/${sessionId}`, {
    method: 'DELETE',
    credentials: 'include',
    headers: fpHeader(),
  })
  forgetSession(docId, sessionId)
}

/** Max file uploads per chat message (server enforces the same limit). */
export const MAX_ATTACHMENTS_PER_MESSAGE = 5
/** Per-file upload cap shown in the UI (server rejects >5 MB with 413). */
export const MAX_ATTACHMENT_MB = 5

export interface AttachmentResult {
  id: string
  filename: string
  mime_type: string
  size_bytes: number
  status: 'processing' | 'ready' | 'failed' | 'deleted'
  truncated: boolean
  error: string | null
}

export class AttachmentUploadError extends Error {
  constructor(
    readonly httpStatus: number,
    message: string,
  ) {
    super(message)
  }
}

async function errDetail(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { detail?: string }
    return body.detail ?? fallback
  } catch {
    return fallback
  }
}

/** Upload one attachment; resolves with the processing row (poll for status). */
export async function uploadAttachment(
  docId: string,
  file: File,
  sessionId?: string,
): Promise<AttachmentResult> {
  const form = new FormData()
  form.append('file', file, file.name)
  if (sessionId) form.append('session_id', sessionId)
  const res = await fetch(`${API_URL}/v1/chat/${docId}/attachments`, {
    method: 'POST',
    credentials: 'include',
    body: form,
  })
  if (!res.ok) {
    throw new AttachmentUploadError(
      res.status,
      await errDetail(res, `Upload lampiran gagal (HTTP ${res.status}).`),
    )
  }
  return (await res.json()) as AttachmentResult
}

/** Poll a processing attachment until ready/failed (or the signal aborts). */
export async function pollAttachment(
  docId: string,
  attachmentId: string,
  onTick: (status: AttachmentResult) => boolean | void,
  signal: AbortSignal,
): Promise<void> {
  // 700ms poll cadence — OCR/text land in seconds, PDF convert can take ~1 min.
  while (!signal.aborted) {
    const res = await fetch(
      `${API_URL}/v1/chat/${docId}/attachments/${attachmentId}`,
      { credentials: 'include' },
    )
    if (res.ok) {
      const row = (await res.json()) as AttachmentResult
      onTick(row)
      if (row.status !== 'processing') return
    }
    await new Promise((resolve) => setTimeout(resolve, 700))
  }
}

export async function deleteAttachmentApi(
  docId: string,
  attachmentId: string,
): Promise<void> {
  // Best-effort: the server soft-deletes; a hiccup must not block the UI.
  await fetch(
    `${API_URL}/v1/chat/${docId}/attachments/${attachmentId}`,
    { method: 'DELETE', credentials: 'include' },
  ).catch(() => undefined)
}
