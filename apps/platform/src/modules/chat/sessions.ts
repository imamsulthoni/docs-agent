import { getOrCreateFpId } from '../../lib/identity'

/** sessionId is canonical: doc:<docId>:s:<rand> (validated server-side). */
export function newSessionId(docId: string): string {
  const rand = getOrCreateFpId().slice(0, 8) + Math.random().toString(36).slice(2, 18)
  return `doc:${docId}:s:${rand.replace(/[^A-Za-z0-9_-]/g, '')}`
}

function sessionsKey(docId: string): string {
  return `docs-agent:sessions:${getOrCreateFpId()}:${docId}`
}

export function listSessions(docId: string): string[] {
  try {
    const raw = localStorage.getItem(sessionsKey(docId))
    const parsed = raw ? (JSON.parse(raw) as unknown) : []
    return Array.isArray(parsed) ? (parsed as string[]) : []
  } catch {
    return []
  }
}

export function rememberSession(docId: string, sessionId: string): void {
  const next = [sessionId, ...listSessions(docId).filter((s) => s !== sessionId)].slice(0, 20)
  try {
    localStorage.setItem(sessionsKey(docId), JSON.stringify(next))
  } catch {
    /* storage blocked */
  }
}

export function forgetSession(docId: string, sessionId: string): void {
  try {
    localStorage.setItem(
      sessionsKey(docId),
      JSON.stringify(listSessions(docId).filter((s) => s !== sessionId)),
    )
  } catch {
    /* storage blocked */
  }
}

/** Drop the whole session list of one document (e.g. after the document is deleted). */
export function forgetAllDocSessions(docId: string): void {
  try {
    localStorage.removeItem(sessionsKey(docId))
  } catch {
    /* storage blocked */
  }
}
