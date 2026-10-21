import { ADMIN_EMAILS, env } from '../../config.js'

export type DebugUser = { email?: string | null } | null | undefined

/**
 * `/v1/debug/*` is for admins in production. Outside production it stays open
 * so local diagnosis does not need configuration. `/v1/status/:docId` is a
 * different, always-public endpoint used by the platform.
 */
export function isDebugAdmin(
  user: DebugUser,
  nodeEnv: string = env('NODE_ENV', 'development'),
  adminEmails: string[] = ADMIN_EMAILS,
): boolean {
  if (nodeEnv !== 'production') return true
  const email = user?.email?.trim().toLowerCase()
  return Boolean(email && adminEmails.includes(email))
}
