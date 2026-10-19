import { Link, useNavigate } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { MarkdownView } from './MarkdownView'
import { ExpiryNotice } from './ExpiryNotice'
import { ChatPanel } from '../chat/ChatPanel'
import { useConfirm } from '../../components/ConfirmDialog'
import { Breadcrumb } from '../../components/Breadcrumb'
import { Spinner } from '../../components/ui/Spinner'
import { Alert } from '../../components/ui/Alert'
import { Toc, type TocItem } from './Toc'
import { API_URL } from '../../lib/api'
import { useSession } from '../../lib/auth'
import { fetchMarkdown } from './api'
import { deleteDocument, listDocuments, type DocSummary } from '../library/api'
import { getWorkspace } from '../workspace/api'
import type { ConvertResponse } from '../convert/api'
import { forgetAllDocSessions } from '../chat/sessions'
import { useI18n } from '../../lib/i18n'

const PREVIEW_KEY = 'docsagent:preview-open'

function loadMeta(docId: string): ConvertResponse | null {
  try {
    const raw = sessionStorage.getItem(`docsagent:last:${docId}`)
    return raw ? (JSON.parse(raw) as ConvertResponse) : null
  } catch {
    return null
  }
}

export function ResultPage({
  docId,
  workspaceId,
}: {
  docId: string
  /** When set, back/delete return to the workspace instead of the guest home. */
  workspaceId?: string
}) {
  const navigate = useNavigate()
  const confirm = useConfirm()
  const { t } = useI18n()
  const { data: session } = useSession()
  const [markdown, setMarkdown] = useState<string | null>(null)
  const [meta, setMeta] = useState<ConvertResponse | null>(null)
  const [listed, setListed] = useState<DocSummary | null>(null)
  const [view, setView] = useState<'preview' | 'raw'>('preview')
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [headings, setHeadings] = useState<TocItem[]>([])
  const [tocOpen, setTocOpen] = useState(false)
  const [wsName, setWsName] = useState<string | null>(null)
  const [previewOpen, setPreviewOpen] = useState<boolean>(() => {
    try {
      return sessionStorage.getItem(PREVIEW_KEY) !== 'hidden'
    } catch {
      return true
    }
  })
  const headingRef = useRef<HTMLHeadingElement>(null)
  const articleRef = useRef<HTMLElement>(null)
  const docScrollRef = useRef<HTMLDivElement>(null)

  function togglePreview() {
    setPreviewOpen((v) => {
      const next = !v
      try {
        sessionStorage.setItem(PREVIEW_KEY, next ? 'open' : 'hidden')
      } catch {
        /* storage blocked — session-only state */
      }
      return next
    })
  }

  useEffect(() => {
    if (!workspaceId) return
    let cancelled = false
    getWorkspace(workspaceId)
      .then((w) => {
        if (!cancelled) setWsName(w.name)
      })
      .catch(() => {
        /* breadcrumb falls back to the workspace id label */
      })
    return () => {
      cancelled = true
    }
  }, [workspaceId])

  useEffect(() => {
    let cancelled = false
    setMarkdown(null)
    setError(null)
    setTocOpen(false)
    setMeta(loadMeta(docId))
    fetchMarkdown(docId)
      .then((md) => {
        if (!cancelled) {
          setMarkdown(md)
          headingRef.current?.focus()
        }
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setError(
            err instanceof Error ? err.message : t('result.errLoad'),
          )
      })
    return () => {
      cancelled = true
    }
  }, [docId])

  useEffect(() => {
    let cancelled = false
    setListed(null)
    listDocuments()
      .then((docs) => {
        if (!cancelled) setListed(docs.find((d) => d.doc_id === docId) ?? null)
      })
      .catch(() => {
        /* filename/stats are optional — page works without them */
      })
    return () => {
      cancelled = true
    }
  }, [docId])

  useEffect(() => {
    const root = articleRef.current
    if (markdown === null || view !== 'preview' || !root) {
      setHeadings([])
      return
    }
    const found: TocItem[] = []
    root.querySelectorAll<HTMLHeadingElement>('h1, h2, h3').forEach((h) => {
      const clone = h.cloneNode(true) as HTMLHeadingElement
      clone.querySelector('.md-anchor')?.remove()
      const text = clone.textContent?.trim() ?? ''
      if (h.id && text) found.push({ id: h.id, level: Number(h.tagName[1]), text })
    })
    setHeadings(found)
  }, [markdown, view])

  async function copyMarkdown() {
    if (!markdown) return
    await navigator.clipboard.writeText(markdown)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 2000)
  }

  async function onDelete() {
    const ok = await confirm({
      title: t('result.deleteTitle'),
      detail: listed?.filename ?? docId,
      description: t('result.deleteDesc'),
    })
    if (!ok) return
    setError(null)
    setDeleting(true)
    try {
      await deleteDocument(docId)
      forgetAllDocSessions(docId)
      try {
        sessionStorage.removeItem(`docsagent:last:${docId}`)
      } catch {
        /* storage blocked — nothing to clean up */
      }
      if (workspaceId) {
        void navigate({
          to: '/w/$workspaceId',
          params: { workspaceId },
        })
      } else {
        void navigate({ to: '/' })
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('result.errDelete'))
      setDeleting(false)
    }
  }

  const expiresAt = meta?.expires_at ?? listed?.expires_at ?? null
  const title = listed?.filename ?? t('result.titleDefault')
  const hasToc = view === 'preview' && headings.length > 1
  const showToc = tocOpen && hasToc

  const action =
    'rounded-md border border-line px-3.5 py-2 text-sm font-medium transition-colors hover:border-line-strong hover:bg-surface'

  return (
    <div className="flex min-h-0 flex-1 flex-col lg:overflow-hidden">
      <Breadcrumb
        className="shrink-0"
        items={
          workspaceId
            ? [
                { label: t('ws.back'), to: '/dashboard' },
                {
                  label: wsName ?? t('ws.loading'),
                  to: '/w/$workspaceId',
                  params: { workspaceId },
                },
                { label: title },
              ]
            : [{ label: t('result.crmbsDocs'), to: '/' }, { label: title }]
        }
      />

      {/* Toolbar: static header row — the columns below scroll on their own */}
      <div className="mt-3 shrink-0 border-b border-line pb-3">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1
              id="result-heading"
              ref={headingRef}
              tabIndex={-1}
              title={title}
              className="max-w-[60ch] truncate text-2xl font-semibold tracking-tight focus:outline-none"
            >
              {title}
            </h1>
          </div>
          <div className="flex flex-wrap gap-2">
            <a href={`${API_URL}/v1/download/${docId}`} className={action}>
              {t('result.download')}
            </a>
            <button
              type="button"
              onClick={copyMarkdown}
              disabled={!markdown}
              className="rounded-md bg-accent px-3.5 py-2 text-sm font-semibold text-accent-ink transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              {copied ? t('result.copied') : t('result.copy')}
            </button>
            <button
              type="button"
              onClick={() => void onDelete()}
              disabled={deleting}
              className="rounded-md border border-line px-3.5 py-2 text-sm font-medium text-danger transition-colors hover:border-danger/50 hover:bg-danger/10 disabled:opacity-40"
            >
              {deleting ? t('result.deleting') : t('result.delete')}
            </button>
          </div>
        </div>
        <div role="tablist" aria-label={t('result.viewLabel')} className="mt-3 flex items-center justify-between gap-6">
          <div className="flex gap-6">
          {(['preview', 'raw'] as const).map((v) => (
            <button
              key={v}
              role="tab"
              aria-selected={view === v}
              onClick={() => setView(v)}
              className={`-mb-[13px] border-b-2 pb-2.5 text-sm font-medium transition-colors ${
                view === v
                  ? 'border-accent text-fg'
                  : 'border-transparent text-fg-soft hover:text-fg'
              }`}
            >
              {v === 'raw' ? t('result.source') : t('result.preview')}
            </button>
          ))}
          </div>
          {hasToc && (
            <button
              type="button"
              onClick={() => setTocOpen((o) => !o)}
              aria-expanded={tocOpen}
              aria-label={t('toc.title')}
              className="rounded-md border border-line px-2.5 py-1 text-xs font-medium text-fg-soft transition-colors hover:border-line-strong hover:text-fg"
            >
              {t('result.tocToggle')} ({headings.length}) {tocOpen ? '▴' : '▾'}
            </button>
          )}
        </div>
      </div>

      {expiresAt && !session?.user && (
        <div className="mt-4 shrink-0">
          <ExpiryNotice expiresAt={expiresAt} />
        </div>
      )}

      <div
        className={`mt-5 gap-5 lg:grid lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(20rem,26rem)_minmax(0,1fr)] lg:grid-rows-1 ${
          showToc ? 'xl:grid-cols-[26rem_minmax(0,1fr)_10rem]' : ''
        }`}
      >
        <aside className="min-w-0 max-lg:order-2 max-lg:mb-5 lg:min-h-0 lg:h-full">
          <ChatPanel
            docId={docId}
            workspaceId={workspaceId}
            className="h-[70dvh] lg:h-full"
          />
        </aside>

        <div
          ref={docScrollRef}
          className="min-w-0 max-lg:order-1 lg:h-full lg:min-h-0 lg:overflow-y-auto lg:pb-1 lg:pr-1"
        >
          <div aria-live="polite" className="text-sm">
            {error && (
              <Alert className="px-4 py-3">
                {error}{' '}
                <Link to="/" className="underline underline-offset-2">
                  {t('common.convertAnother')}
                </Link>
              </Alert>
            )}
            {markdown === null && !error && (
              <div className="rounded-lg border border-line bg-surface p-10 text-center">
                <Spinner className="mx-auto h-6 w-6" />
                <p className="mt-3 text-fg-soft">{t('result.loadingDoc')}</p>
              </div>
            )}
          </div>

          {markdown !== null && (
            <div className="rounded-lg border border-line bg-surface">
              {/*
                Mobile-only accordion header: collapsing hides the long
                markdown so the chat panel below is reachable without scrolling
                the whole document.
              */}
              <button
                type="button"
                onClick={togglePreview}
                aria-expanded={previewOpen}
                aria-controls="preview-body"
                className="flex w-full items-center justify-between border-b border-line px-4 py-2.5 text-xs font-medium text-fg-soft transition-colors hover:text-fg lg:hidden"
              >
                <span>{previewOpen ? t('result.previewHide') : t('result.previewShow')}</span>
                <span aria-hidden className="font-mono tracking-widest">
                  {previewOpen ? '▾' : '▸'}
                </span>
              </button>
              <div id="preview-body" className={`${previewOpen ? '' : 'max-lg:hidden'}`}>
                {view === 'preview' ? (
                  <article
                    ref={articleRef}
                    className={`mx-auto px-6 py-6 sm:px-10 sm:py-10 ${showToc ? 'max-w-4xl' : 'max-w-5xl'}`}
                  >
                    <MarkdownView markdown={markdown} />
                  </article>
                ) : (
                  <pre className="overflow-auto rounded-lg bg-code p-6 font-mono text-[0.8rem] leading-relaxed">
                    {markdown}
                  </pre>
                )}
              </div>
            </div>
          )}
        </div>

        {showToc && (
          <div className="hidden min-w-0 lg:min-h-0 lg:overflow-y-auto lg:pb-8 xl:block">
            <Toc items={headings} containerRef={docScrollRef} />
          </div>
        )}
      </div>
    </div>
  )
}
