import { createAuthClient } from 'better-auth/react'
import { redirect } from '@tanstack/react-router'
import { API_URL } from './api'

/**
 * Better Auth client for the gateway. The platform and the API are the same
 * site (both 127.0.0.1, different ports), so the httpOnly session cookie rides
 * along once `credentials: 'include'` is set — no token in localStorage.
 */
export const authClient = createAuthClient({
  baseURL: API_URL,
  fetchOptions: { credentials: 'include' },
})

export const { useSession, signIn, signUp, signOut } = authClient

/**
 * Route guard for login-only pages. Throws a redirect to /login when there is
 * no session; returns the user otherwise. Use in a route's `beforeLoad`.
 */
export async function requireSession(): Promise<{ id: string; name: string; email: string }> {
  const { data } = await authClient.getSession()
  if (!data?.user) {
    throw redirect({ to: '/login' })
  }
  return data.user as { id: string; name: string; email: string }
}

export interface AuthConfig {
  emailPassword: boolean
  google: boolean
}

/** Which sign-in methods the gateway has configured (Google is optional). */
export async function fetchAuthConfig(): Promise<AuthConfig> {
  try {
    const res = await fetch(`${API_URL}/v1/auth/config`)
    if (!res.ok) return { emailPassword: true, google: false }
    return (await res.json()) as AuthConfig
  } catch {
    return { emailPassword: true, google: false }
  }
}
