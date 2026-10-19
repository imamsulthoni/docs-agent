import { Link, createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import {
  fetchAuthConfig,
  signIn,
  signOut,
  signUp,
  useSession,
  type AuthConfig,
} from '../lib/auth'
import { useI18n } from '../lib/i18n'
import { Button } from '../components/ui/Button'
import { Alert } from '../components/ui/Alert'

export const Route = createFileRoute('/login')({
  component: LoginPage,
})

type Mode = 'signin' | 'signup'

function LoginPage() {
  const { t } = useI18n()
  const { data: session, isPending } = useSession()
  const [config, setConfig] = useState<AuthConfig | null>(null)
  const [mode, setMode] = useState<Mode>('signin')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void fetchAuthConfig().then(setConfig)
  }, [])

  async function onEmailPassword(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      if (mode === 'signup') {
        const { error: err } = await signUp.email({ email, password, name })
        if (err) throw new Error(err.message ?? 'signup failed')
      } else {
        const { error: err } = await signIn.email({ email, password })
        if (err) throw new Error(err.message ?? 'signin failed')
      }
      window.location.assign('/dashboard')
    } catch (err) {
      setError(err instanceof Error ? err.message : t('auth.errSignIn'))
      setBusy(false)
    }
  }

  async function onGoogle() {
    setError(null)
    setBusy(true)
    try {
      await signIn.social({
        provider: 'google',
        callbackURL: `${window.location.origin}/dashboard`,
      })
    } catch {
      setError(t('auth.errSignIn'))
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-6 py-10">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {t('auth.loginTitle')}
        </h1>
        <p className="mt-2 text-sm text-fg-soft">{t('auth.loginSubtitle')}</p>
      </div>

      {error && <Alert className="px-3 py-2 text-sm">{error}</Alert>}

      {isPending ? (
        <p className="text-sm text-fg-soft">{t('auth.checkingSession')}</p>
      ) : session?.user ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm">{session.user.name || session.user.email}</p>
          <div className="flex gap-2">
            <Link
              to="/"
              className="rounded-md border border-line px-3.5 py-2 text-sm font-medium transition-colors hover:border-line-strong hover:bg-surface"
            >
              {t('result.back')}
            </Link>
            <Button variant="outline" onClick={() => void signOut()}>
              {t('auth.signOut')}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div
            role="tablist"
            aria-label={t('auth.loginTitle')}
            className="flex gap-6 border-b border-line"
          >
            {(['signin', 'signup'] as const).map((m) => (
              <button
                key={m}
                role="tab"
                aria-selected={mode === m}
                type="button"
                onClick={() => {
                  setMode(m)
                  setError(null)
                }}
                className={`-mb-px border-b-2 pb-2.5 text-sm font-medium transition-colors ${
                  mode === m
                    ? 'border-accent text-fg'
                    : 'border-transparent text-fg-soft hover:text-fg'
                }`}
              >
                {m === 'signin' ? t('auth.tabSignIn') : t('auth.tabSignUp')}
              </button>
            ))}
          </div>

          <form className="flex flex-col gap-3" onSubmit={onEmailPassword}>
            {mode === 'signup' && (
              <label className="flex flex-col gap-1 text-sm">
                <span className="label">{t('auth.name')}</span>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="rounded-md border border-line-strong bg-bg px-3 py-2 text-sm"
                />
              </label>
            )}
            <label className="flex flex-col gap-1 text-sm">
              <span className="label">{t('auth.email')}</span>
              <input
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="rounded-md border border-line-strong bg-bg px-3 py-2 text-sm"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="label">{t('auth.password')}</span>
              <input
                type="password"
                required
                minLength={8}
                autoComplete={
                  mode === 'signup' ? 'new-password' : 'current-password'
                }
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="rounded-md border border-line-strong bg-bg px-3 py-2 text-sm"
              />
            </label>
            <Button variant="accent" size="lg" type="submit" disabled={busy}>
              {busy
                ? t('auth.working')
                : mode === 'signup'
                  ? t('auth.tabSignUp')
                  : t('auth.tabSignIn')}
            </Button>
          </form>

          {config?.google && (
            <>
              <p className="text-center text-xs text-fg-faint">{t('auth.or')}</p>
              <Button
                variant="outline"
                size="lg"
                disabled={busy}
                onClick={() => void onGoogle()}
              >
                {t('auth.google')}
              </Button>
            </>
          )}

          <p className="text-xs text-fg-soft">{t('auth.guestNote')}</p>
        </div>
      )}
    </div>
  )
}
