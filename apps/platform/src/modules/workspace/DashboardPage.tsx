import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link } from '@tanstack/react-router'
import { localeTag, useI18n } from '../../lib/i18n'
import { Alert } from '../../components/ui/Alert'
import { Button } from '../../components/ui/Button'
import {
  ArrowRightIcon,
  FileIcon,
  FolderIcon,
  PlusIcon,
} from '../../components/icons'
import { createWorkspace, listWorkspaces, type Workspace } from './api'
import { listDocuments, type DocSummary } from '../library/api'

function formatDate(iso?: string): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString(localeTag(), {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

function CardSkeleton() {
  return (
    <div
      aria-hidden
      className="h-[4.75rem] animate-pulse rounded-lg border border-line bg-surface"
    />
  )
}

function RowSkeleton() {
  return (
    <div
      aria-hidden
      className="h-14 animate-pulse border-b border-line bg-surface/40"
    />
  )
}

function EmptyState({
  icon,
  title,
  hint,
  compact = false,
  action,
}: {
  icon: React.ReactNode
  title: string
  hint: string
  compact?: boolean
  action?: React.ReactNode
}) {
  return (
    <div
      className={`flex flex-col items-center gap-1.5 rounded-lg border border-dashed border-line text-center ${
        compact ? 'px-6 py-7' : 'px-6 py-10'
      }`}
    >
      <span
        className={`flex items-center justify-center rounded-md border border-line bg-surface text-fg-faint ${
          compact ? 'h-8 w-8' : 'h-10 w-10'
        }`}
      >
        {icon}
      </span>
      <p className="mt-1 text-sm font-medium">{title}</p>
      <p className="max-w-sm text-sm text-fg-soft">{hint}</p>
      {action && <div className="mt-3">{action}</div>}
    </div>
  )
}

/** Native <dialog> create-workspace form. Submits and closes on success. */
function NewWorkspaceDialog({
  open,
  onClose,
  onCreate,
}: {
  open: boolean
  onClose: () => void
  onCreate: (name: string) => Promise<void>
}) {
  const { t } = useI18n()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) {
      dialog.showModal()
      inputRef.current?.focus()
    } else if (!open && dialog.open) {
      dialog.close()
    }
  }, [open])

  useEffect(() => {
    if (open) {
      setName('')
      setError(null)
      setCreating(false)
    }
  }, [open])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!name.trim() || creating) return
    setError(null)
    setCreating(true)
    try {
      await onCreate(name.trim())
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.unknownError'))
    } finally {
      setCreating(false)
    }
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="new-ws-title"
      onCancel={(e) => {
        e.preventDefault()
        if (!creating) onClose()
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !creating) onClose()
      }}
      className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-lg border border-line-strong bg-surface p-0 text-fg backdrop:bg-black/60"
    >
      <form onSubmit={onSubmit} className="flex flex-col">
        <div className="border-b border-line px-6 py-5">
          <h2
            id="new-ws-title"
            className="flex items-center gap-2 text-base font-semibold tracking-tight"
          >
            <PlusIcon className="h-4 w-4 text-fg-soft" />
            {t('dashboard.newWorkspace')}
          </h2>
          <p className="mt-1.5 text-sm text-fg-soft">
            {t('dashboard.newHint')}
          </p>
        </div>

        <div className="px-6 py-5">
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="label">{t('dashboard.workspaceName')}</span>
            <input
              ref={inputRef}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('dashboard.namePlaceholder')}
              maxLength={120}
              className="w-full rounded-md border border-line-strong bg-bg px-3 py-2 text-sm placeholder:text-fg-faint"
            />
          </label>
          {error && <Alert className="mt-3 px-3 py-2 text-sm">{error}</Alert>}
        </div>

        <div className="flex justify-end gap-2 border-t border-line px-6 py-4">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={creating}
          >
            {t('common.cancel')}
          </Button>
          <Button
            type="submit"
            variant="accent"
            disabled={creating || !name.trim()}
          >
            {creating ? t('dashboard.creating') : t('dashboard.create')}
          </Button>
        </div>
      </form>
    </dialog>
  )
}

export function DashboardPage() {
  const { t } = useI18n()
  const [workspaces, setWorkspaces] = useState<Workspace[] | null>(null)
  const [docs, setDocs] = useState<DocSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [creatingOpen, setCreatingOpen] = useState(false)

  async function load() {
    setError(null)
    try {
      const [ws, ds] = await Promise.all([listWorkspaces(), listDocuments()])
      setWorkspaces(ws)
      setDocs(ds)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.unknownError'))
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function onCreate(name: string) {
    const ws = await createWorkspace(name)
    setWorkspaces((prev) => (prev ? [ws, ...prev] : [ws]))
  }

  const workspaceNames = useMemo(() => {
    const map = new Map<string, string>()
    for (const w of workspaces ?? []) map.set(w.id, w.name)
    return map
  }, [workspaces])

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-wrap items-end justify-between gap-6 border-b border-line pb-6">
        <div className="min-w-0">
          <p className="label">{t('dashboard.step')}</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight">
            {t('dashboard.title')}
          </h1>
          <p className="mt-2 max-w-xl text-sm text-fg-soft">
            {t('dashboard.subtitle')}
          </p>
        </div>
        <div className="flex w-full flex-wrap items-center justify-between gap-4 sm:w-auto sm:flex-nowrap sm:items-end sm:gap-8">
          <dl className="flex items-center gap-6 sm:gap-8">
            <div>
              <dt className="label">{t('dashboard.statWorkspaces')}</dt>
              <dd className="mt-1 font-mono text-2xl font-medium tabular-nums">
                {workspaces === null ? '—' : workspaces.length}
              </dd>
            </div>
            <span aria-hidden className="h-9 w-px bg-line" />
            <div>
              <dt className="label">{t('dashboard.statDocs')}</dt>
              <dd className="mt-1 font-mono text-2xl font-medium tabular-nums">
                {docs === null ? '—' : docs.length}
              </dd>
            </div>
          </dl>
          <Button
            variant="accent"
            onClick={() => setCreatingOpen(true)}
            className="inline-flex items-center gap-1.5 whitespace-nowrap"
          >
            <PlusIcon className="h-3.5 w-3.5" />
            {t('dashboard.newWorkspace')}
          </Button>
        </div>
      </header>

      {error && <Alert className="px-3 py-2 text-sm">{error}</Alert>}

      <section aria-labelledby="ws-list-heading">
        <div className="flex items-baseline justify-between gap-3 border-b border-line pb-2">
          <h2
            id="ws-list-heading"
            className="text-lg font-semibold tracking-tight"
          >
            {t('dashboard.allWorkspaces')}
          </h2>
          <span className="font-mono text-xs text-fg-soft">
            {workspaces?.length ?? 0}
          </span>
        </div>

        {workspaces === null ? (
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <CardSkeleton />
            <CardSkeleton />
            <CardSkeleton />
          </div>
        ) : workspaces.length === 0 ? (
          <div className="mt-4">
            <EmptyState
              icon={<FolderIcon className="h-4 w-4" />}
              title={t('dashboard.emptyTitle')}
              hint={t('dashboard.emptyHint')}
              action={
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCreatingOpen(true)}
                  className="inline-flex items-center gap-1.5"
                >
                  <PlusIcon className="h-3.5 w-3.5" />
                  {t('dashboard.newWorkspace')}
                </Button>
              }
            />
          </div>
        ) : (
          <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {workspaces.map((w) => (
              <li key={w.id}>
                <Link
                  to="/w/$workspaceId"
                  params={{ workspaceId: w.id }}
                  className="group flex h-full items-center gap-3 rounded-lg border border-line bg-surface p-4 transition-colors hover:border-line-strong hover:bg-surface-2"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-line bg-bg text-fg-soft transition-colors group-hover:border-accent/40 group-hover:text-accent-text">
                    <FolderIcon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">
                      {w.name}
                    </span>
                    <span className="mt-1 flex flex-wrap items-center gap-x-1.5 font-mono text-[11px] text-fg-soft">
                      <span>
                        {t('dashboard.docCount', {
                          n: w.documentCount ?? 0,
                        })}
                      </span>
                      {w.createdAt && (
                        <>
                          <span aria-hidden>·</span>
                          <span>{formatDate(w.createdAt)}</span>
                        </>
                      )}
                    </span>
                  </div>
                  <ArrowRightIcon className="h-4 w-4 shrink-0 text-fg-faint transition-transform group-hover:translate-x-0.5 group-hover:text-fg" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="recent-heading">
        <div className="flex items-baseline justify-between gap-3 border-b border-line pb-2">
          <h2
            id="recent-heading"
            className="text-lg font-semibold tracking-tight"
          >
            {t('dashboard.recent')}
          </h2>
          <span className="font-mono text-xs text-fg-soft">
            {docs?.length ?? 0}
          </span>
        </div>

        {docs === null ? (
          <div className="mt-1">
            <RowSkeleton />
            <RowSkeleton />
            <RowSkeleton />
          </div>
        ) : docs.length === 0 ? (
          <div className="mt-4">
            <EmptyState
              compact
              icon={<FileIcon className="h-3.5 w-3.5" />}
              title={t('dashboard.recentEmptyTitle')}
              hint={t('dashboard.recentEmptyHint')}
            />
          </div>
        ) : (
          <ul className="mt-1 divide-y divide-line">
            {docs.slice(0, 8).map((d) => {
              const body = (
                <>
                  <FileIcon className="h-4 w-4 shrink-0 text-fg-faint transition-colors group-hover:text-accent-text" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium transition-colors group-hover:text-accent-text">
                      {d.filename ?? d.doc_id}
                    </span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-x-2 font-mono text-[11px] text-fg-soft">
                      <span>
                        {d.workspace_id
                          ? (workspaceNames.get(d.workspace_id) ??
                            t('dashboard.noWorkspace'))
                          : t('dashboard.noWorkspace')}
                      </span>
                      <span aria-hidden>·</span>
                      <span>{formatDate(d.created_at)}</span>
                    </span>
                  </span>
                  <ArrowRightIcon className="h-4 w-4 shrink-0 text-fg-faint opacity-0 transition-opacity group-hover:opacity-100" />
                </>
              )
              const rowClass = 'group flex items-center gap-3 py-3.5'
              return (
                <li key={d.doc_id}>
                  {d.workspace_id ? (
                    <Link
                      to="/w/$workspaceId/d/$docId"
                      params={{
                        workspaceId: d.workspace_id,
                        docId: d.doc_id,
                      }}
                      className={rowClass}
                    >
                      {body}
                    </Link>
                  ) : (
                    <Link
                      to="/r/$docId"
                      params={{ docId: d.doc_id }}
                      className={rowClass}
                    >
                      {body}
                    </Link>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <NewWorkspaceDialog
        open={creatingOpen}
        onClose={() => setCreatingOpen(false)}
        onCreate={onCreate}
      />
    </div>
  )
}
