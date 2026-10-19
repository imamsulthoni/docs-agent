const UID_KEY = 'docs-agent:uid'

/**
 * Stable browser fingerprint. Not auth: a localStorage UUID plus a light
 * navigator hash so the id survives partial storage wipes. The server only
 * uses it to scope chat memory per user (header `x-user-id: fp:<id>`).
 */
function navigatorHash(): string {
  if (typeof navigator === 'undefined') return '0'
  const raw = [
    navigator.userAgent,
    navigator.language,
    String(window.screen?.width ?? 0),
    String(window.screen?.height ?? 0),
    String(new Date().getTimezoneOffset()),
  ].join('|')
  let h = 2166136261
  for (let i = 0; i < raw.length; i++) {
    h ^= raw.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(36)
}

function randomId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID().replace(/-/g, '').slice(0, 16)
  }
  return Math.random().toString(36).slice(2, 18)
}

export function getOrCreateFpId(): string {
  try {
    const existing = localStorage.getItem(UID_KEY)
    if (existing) return existing
  } catch {
    /* storage blocked */
  }
  const id = `${randomId()}${navigatorHash()}`
  try {
    localStorage.setItem(UID_KEY, id)
  } catch {
    /* storage blocked */
  }
  return id
}

export function resetFpId(): string {
  try {
    localStorage.removeItem(UID_KEY)
  } catch {
    /* storage blocked */
  }
  return getOrCreateFpId()
}

export function fpHeader(): Record<string, string> {
  return { 'x-user-id': `fp:${getOrCreateFpId()}` }
}
