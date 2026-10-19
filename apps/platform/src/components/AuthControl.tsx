import { Link, useNavigate } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { signOut, useSession } from '../lib/auth'
import { useI18n } from '../lib/i18n'

function initials(name: string | null | undefined, email: string): string {
  const source = (name ?? '').trim() || email
  const parts = source.split(/[\s@._-]+/).filter(Boolean)
  const letters = parts
    .slice(0, 2)
    .map((part) => part[0] ?? '')
    .join('')
  return (letters || source.slice(0, 2)).toUpperCase()
}

/**
 * Header account control. Guests get a single sign-in button; signed-in users
 * get an avatar chip that opens a small menu (identity, dashboard, sign out),
 * keeping auth visually separate from the theme/language switches.
 */
export function AuthControl() {
  const { t } = useI18n()
  const { data: session, isPending } = useSession()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onPointerDown(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  if (isPending) {
    return <span aria-hidden className="h-8 w-8 rounded-full bg-surface-2" />
  }

  if (!session?.user) {
    return (
      <Link
        to="/login"
        className="rounded-md bg-accent px-3.5 py-1.5 text-sm font-semibold text-accent-ink transition-opacity hover:opacity-90"
      >
        {t('auth.signIn')}
      </Link>
    )
  }

  async function onSignOut() {
    setOpen(false)
    await signOut()
    // Guarded routes only re-check the session on navigation, so signing out
    // from /dashboard or /w/... would otherwise leave a sessionless page open.
    void navigate({ to: '/' })
  }

  const name = session.user.name || session.user.email

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('auth.account')}
        className="flex items-center gap-2 rounded-full border border-line py-0.5 pl-0.5 pr-1 transition-colors hover:border-line-strong hover:bg-surface sm:pr-3"
      >
        <span
          aria-hidden
          className="flex h-7 w-7 items-center justify-center rounded-full bg-accent font-mono text-[11px] font-semibold text-accent-ink"
        >
          {initials(session.user.name, session.user.email)}
        </span>
        <span className="hidden max-w-[9rem] truncate text-sm font-medium sm:inline">
          {name}
        </span>
        <svg
          aria-hidden
          viewBox="0 0 24 24"
          width="12"
          height="12"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className={`hidden shrink-0 text-fg-soft transition-transform sm:block ${
            open ? 'rotate-180' : ''
          }`}
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-2 w-60 overflow-hidden rounded-lg border border-line bg-surface shadow-xl shadow-black/20"
        >
          <div className="border-b border-line px-3.5 py-3">
            <p className="truncate text-sm font-medium">{name}</p>
            {session.user.name && (
              <p className="mt-0.5 truncate text-xs text-fg-soft">
                {session.user.email}
              </p>
            )}
          </div>
          <div className="p-1">
            <Link
              to="/dashboard"
              role="menuitem"
              onClick={() => setOpen(false)}
              className="block rounded-md px-2.5 py-2 text-sm transition-colors hover:bg-surface-2"
            >
              {t('auth.dashboard')}
            </Link>
            <button
              type="button"
              role="menuitem"
              onClick={() => void onSignOut()}
              className="block w-full rounded-md px-2.5 py-2 text-left text-sm text-danger transition-colors hover:bg-danger/10"
            >
              {t('auth.signOut')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
