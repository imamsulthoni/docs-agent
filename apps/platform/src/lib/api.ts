const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost'])

/**
 * Keep the gateway on the same host the page was opened from. `localhost` and
 * `127.0.0.1` are different cookie sites, so calling `127.0.0.1:8377` from a
 * `localhost:8378` page makes the session cookie third-party and the browser
 * drops it — sign-in succeeds but /dashboard sees no session.
 */
function resolveApiUrl(): string {
  const configured = import.meta.env?.VITE_API_URL?.replace(/\/$/, '')
  const pageHost = window.location.hostname

  if (!configured) {
    return `${window.location.protocol}//${pageHost}:8377`
  }

  try {
    const url = new URL(configured)
    if (LOOPBACK_HOSTS.has(url.hostname) && LOOPBACK_HOSTS.has(pageHost)) {
      url.hostname = pageHost
    }
    return url.toString().replace(/\/$/, '')
  } catch {
    return configured
  }
}

export const API_URL = resolveApiUrl()

export function absoluteUrl(path: string): string {
  if (/^https?:\/\//.test(path)) return path
  return `${API_URL}${path.startsWith('/') ? '' : '/'}${path}`
}

/**
 * Resolve a markdown asset URL against the gateway.
 *
 * Indexed pages carry absolute `PUBLIC_BASE_URL` links (e.g.
 * `http://127.0.0.1:8377/public/...`), and chat answers echo them back. On a
 * `localhost:8378` page that origin is a *different site*, so the browser drops
 * the session cookie and private `/public` images answer 404. Rebind loopback
 * asset origins to the API host this page actually talks to.
 */
export function mediaUrl(src: string): string {
  if (!src) return src
  if (src.startsWith('/')) return `${API_URL}${src}`

  let url: URL
  try {
    url = new URL(src)
  } catch {
    return absoluteUrl(src)
  }

  if (!/^https?:$/.test(url.protocol)) return src
  if (!LOOPBACK_HOSTS.has(url.hostname) || !url.pathname.startsWith('/public/')) {
    return src
  }

  const api = new URL(API_URL)
  url.protocol = api.protocol
  url.hostname = api.hostname
  url.port = api.port
  return url.toString()
}

/**
 * fetch to the gateway with the session cookie attached. The platform and API
 * are the same site on different ports, so credentialed requests are needed
 * for login-scoped routes (workspaces, owned files).
 */
export function apiFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  return fetch(absoluteUrl(path), { credentials: 'include', ...init })
}

export function errDetail(text: string, fallback: string): string {
  try {
    const body = JSON.parse(text) as { detail?: string }
    if (typeof body.detail === 'string' && body.detail) return body.detail
  } catch {
    /* not JSON — use raw text */
  }
  return text || fallback
}
