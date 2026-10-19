export type ParsedName =
  | { ok: true; name: string }
  | { ok: false; status: 400 | 422; detail: string }

const MAX_NAME = 120

/** Validate a workspace name from a request body (trimmed, non-empty, bounded). */
export function parseWorkspaceName(body: unknown): ParsedName {
  const name =
    body && typeof body === 'object'
      ? (body as { name?: unknown }).name
      : undefined
  if (typeof name !== 'string') {
    return { ok: false, status: 422, detail: 'Field "name" is required.' }
  }
  const trimmed = name.trim()
  if (!trimmed) {
    return { ok: false, status: 422, detail: 'Workspace name cannot be empty.' }
  }
  if (trimmed.length > MAX_NAME) {
    return {
      ok: false,
      status: 422,
      detail: `Workspace name must be at most ${MAX_NAME} characters.`,
    }
  }
  return { ok: true, name: trimmed }
}
