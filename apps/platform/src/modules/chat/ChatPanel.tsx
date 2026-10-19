import { useEffect, useState } from 'react'
import { Link } from '@tanstack/react-router'
import type { UIMessage } from '@anvia/react'
import { API_URL } from '../../lib/api'
import { useSession } from '../../lib/auth'
import { useI18n } from '../../lib/i18n'
import { getOrCreateFpId, resetFpId } from '../../lib/identity'
import { Alert } from '../../components/ui/Alert'
import { useConfirm } from '../../components/ConfirmDialog'
import { deleteSession, fetchHistory, fetchStatus, type DocStatus } from './api'
import { listSessions, newSessionId, rememberSession } from './sessions'
import { SessionSelect } from './SessionSelect'
import { DocChat } from './DocChat'

export function ChatPanel({
  docId,
  workspaceId,
  className = '',
}: {
  docId: string
  /** Enables `@` mentions (workspace documents only). */
  workspaceId?: string
  className?: string
}) {
  const [status, setStatus] = useState<DocStatus | null>(null)
  const [sessions, setSessions] = useState<string[]>([])
  const [active, setActive] = useState<string>('')
  const [history, setHistory] = useState<UIMessage[]>([])
  const [historyReady, setHistoryReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [polls, setPolls] = useState(0)
  const [debug, setDebug] = useState<unknown>(null)
  const [debugLoading, setDebugLoading] = useState(false)
  const confirm = useConfirm()
  const { t } = useI18n()
  // Signed-in documents never expire, so "gone" only ever means deleted.
  const { data: session } = useSession()
  const signedIn = Boolean(session?.user)

  async function checkDebug() {
    setDebugLoading(true)
    try {
      const res = await fetch(`${API_URL}/v1/debug/${docId}`)
      const body = (await res.json().catch(() => null)) as unknown
      setDebug(body)
      console.debug('[chat] index debug', body)
    } catch (err) {
      setDebug({ error: err instanceof Error ? err.message : String(err) })
    } finally {
      setDebugLoading(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    setStatus(null)
    setError(null)
    const known = listSessions(docId)
    const initial = known[0] ?? newSessionId(docId)
    rememberSession(docId, initial)
    setSessions([initial, ...known.filter((s) => s !== initial)])
    setActive(initial)

    async function poll() {
      try {
        const s = await fetchStatus(docId)
        if (cancelled) return
        setStatus(s)
        setPolls((p) => p + 1)
        console.debug('[chat] index status', s)
        if (s.found && !s.indexed) window.setTimeout(poll, 3000)
      } catch (err) {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : t('chat.errStatus')
          console.debug('[chat] index status failed', msg)
          setError(msg)
        }
      }
    }
    void poll()
    return () => {
      cancelled = true
    }
  }, [docId])

  useEffect(() => {
    if (!active) return
    let cancelled = false
    setHistory([])
    setHistoryReady(false)
    setError(null)
    fetchHistory(docId, active)
      .then((msgs) => {
        if (cancelled) return
        setHistory(msgs)
        setHistoryReady(true)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : t('chat.errHistory'))
        setHistoryReady(true)
      })
    return () => {
      cancelled = true
    }
  }, [docId, active])

  function onNew() {
    const id = newSessionId(docId)
    rememberSession(docId, id)
    setSessions((prev) => [id, ...prev])
    setActive(id)
  }

  async function onDelete(id: string) {
    if (!id) return
    const ok = await confirm({
      title: t('chat.deleteChatTitle'),
      description: t('chat.deleteChatDesc'),
    })
    if (!ok) return
    void deleteSession(docId, id).catch(() => {
      /* best-effort */
    })
    const remaining = sessions.filter((s) => s !== id)
    const next = remaining[0] ?? newSessionId(docId)
    rememberSession(docId, next)
    setSessions([next, ...remaining.filter((s) => s !== next)])
    setActive(next)
  }

  async function onResetIdentity() {
    const ok = await confirm({
      title: t('chat.resetTitle'),
      description: t('chat.resetDesc'),
      confirmLabel: t('chat.resetConfirm'),
    })
    if (!ok) return
    resetFpId()
    window.location.reload()
  }

  const gone = status !== null && !status.found
  const indexing = status !== null && status.found && !status.indexed

  return (
    <section
      aria-labelledby="chat-heading"
      className={`flex flex-col overflow-hidden rounded-lg border border-line bg-surface ${className}`}
    >
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-3">
        <h2
          id="chat-heading"
          className="text-base font-semibold tracking-tight"
        >
          {t('chat.title')}
        </h2>
        <p className="flex items-center gap-2 font-mono text-xs text-fg-soft">
          <span
            aria-hidden
            className={`h-1.5 w-1.5 rounded-full ${
              status === null
                ? 'bg-fg-faint'
                : gone
                  ? 'bg-danger'
                  : indexing
                    ? 'animate-pulse bg-warn'
                    : 'bg-accent-text'
            }`}
          />
          {status === null
            ? t('chat.checking')
            : gone
              ? signedIn
                ? t('chat.deleted')
                : t('chat.expired')
              : indexing
                ? t('chat.indexing')
                : t('chat.indexed', { pages: status.pages })}
        </p>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 px-5 py-4">
        <SessionSelect
          sessions={sessions}
          active={active}
          onChange={setActive}
          onNew={onNew}
          onDelete={(id) => void onDelete(id)}
          disabled={indexing || gone}
        />

        {indexing && (
          <details className="shrink-0 rounded-md border border-line bg-bg px-3 py-2 text-xs text-fg-soft">
            <summary className="cursor-pointer font-medium text-fg">
              {t('chat.debugTitle', { polls })}
            </summary>
            <div className="mt-2 space-y-2">
              <p>
                Status: {status ? JSON.stringify(status) : 'checking…'} · docId:{' '}
                <span className="font-mono">{docId}</span>
              </p>
              <p>{t('chat.debugHelp')}</p>
              <button
                type="button"
                onClick={() => void checkDebug()}
                disabled={debugLoading}
                className="rounded-sm border border-line px-2.5 py-1 text-xs font-medium text-fg hover:bg-surface-2 disabled:opacity-40"
              >
                {debugLoading ? t('chat.debugChecking') : t('chat.debugCheck')}
              </button>
              {debug !== null && (
                <pre className="max-h-64 overflow-auto rounded-sm bg-code p-2 font-mono text-[0.7rem] leading-relaxed text-fg">
                  {JSON.stringify(debug, null, 2)}
                </pre>
              )}
            </div>
          </details>
        )}

        {gone && (
          <p
            role="alert"
            className="shrink-0 border-l-2 border-warn bg-warn/10 px-3 py-2 text-sm"
          >
            {signedIn ? t('chat.deletedNote') : t('chat.goneNote')}{' '}
            <Link to="/" className="underline underline-offset-2">
              {t('common.convertAnother')}
            </Link>
          </p>
        )}

        {error && (
          <Alert className="shrink-0 px-3 py-2 text-sm">{error}</Alert>
        )}

        {active && historyReady ? (
          <DocChat
            key={active}
            docId={docId}
            workspaceId={workspaceId}
            sessionId={active}
            initialHistory={history}
            indexing={indexing}
            gone={gone}
            signedIn={signedIn}
          />
        ) : (
          <p className="flex-1 py-6 text-center text-sm text-fg-soft">
            {t('chat.loadingHistory')}
          </p>
        )}

        <details className="shrink-0 border-t border-line pt-3 text-xs text-fg-soft">
          <summary className="w-fit cursor-pointer select-none underline underline-offset-2 transition-colors hover:text-fg">
            {t('chat.identityTitle')}
          </summary>
          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="truncate font-mono">
              fp:{getOrCreateFpId().slice(0, 10)}…
            </span>
            <button
              type="button"
              onClick={() => void onResetIdentity()}
              className="underline underline-offset-2 hover:text-fg"
            >
              {t('chat.resetIdentity')}
            </button>
          </div>
        </details>
      </div>
    </section>
  )
}
