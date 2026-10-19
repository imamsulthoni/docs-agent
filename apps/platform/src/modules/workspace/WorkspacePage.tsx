import { useEffect, useState, type FormEvent } from 'react'
import { Link } from '@tanstack/react-router'
import { useI18n } from '../../lib/i18n'
import { useConfirm } from '../../components/ConfirmDialog'
import { Breadcrumb } from '../../components/Breadcrumb'
import { Alert } from '../../components/ui/Alert'
import { Button } from '../../components/ui/Button'
import { Spinner } from '../../components/ui/Spinner'
import { DropZone } from '../convert/DropZone'
import { ConvertOptions } from '../convert/ConvertOptions'
import { useConvert } from '../convert/useConvert'
import { DocumentListItem } from '../library/DocumentListItem'
import { deleteDocument, type DocSummary } from '../library/api'
import { forgetAllDocSessions } from '../chat/sessions'
import {
  deleteWorkspace,
  getWorkspace,
  listWorkspaceDocuments,
  renameWorkspace,
} from './api'

export function WorkspacePage({ workspaceId }: { workspaceId: string }) {
  const { t } = useI18n()
  const confirm = useConfirm()
  const c = useConvert(workspaceId)

  const [name, setName] = useState<string | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [docs, setDocs] = useState<DocSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [renaming, setRenaming] = useState(false)
  const [draftName, setDraftName] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [deletingDocId, setDeletingDocId] = useState<string | null>(null)

  async function loadDocs() {
    setError(null)
    try {
      const [ws, ds] = await Promise.all([
        getWorkspace(workspaceId),
        listWorkspaceDocuments(workspaceId),
      ])
      setName(ws.name)
      setDocs(ds)
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('common.unknownError')
      if (/404/.test(msg)) setNotFound(true)
      else setError(msg)
    }
  }

  useEffect(() => {
    void loadDocs()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId])

  async function onRename(e: FormEvent) {
    e.preventDefault()
    if (!draftName.trim()) return
    setError(null)
    setRenaming(true)
    try {
      const ws = await renameWorkspace(workspaceId, draftName.trim())
      setName(ws.name)
      setDraftName('')
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.unknownError'))
    } finally {
      setRenaming(false)
    }
  }

  async function onDeleteWorkspace() {
    const ok = await confirm({
      title: t('ws.deleteTitle'),
      detail: name ?? workspaceId,
      description: t('ws.deleteDesc'),
    })
    if (!ok) return
    setError(null)
    setDeleting(true)
    try {
      await deleteWorkspace(workspaceId)
      window.location.assign('/dashboard')
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.unknownError'))
      setDeleting(false)
    }
  }

  async function onDeleteDoc(doc: DocSummary) {
    const ok = await confirm({
      title: t('library.deleteTitle'),
      detail: doc.filename ?? doc.doc_id,
      description: t('library.deleteDesc'),
    })
    if (!ok) return
    setDeletingDocId(doc.doc_id)
    try {
      await deleteDocument(doc.doc_id)
      forgetAllDocSessions(doc.doc_id)
      setDocs((prev) =>
        prev ? prev.filter((d) => d.doc_id !== doc.doc_id) : prev,
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.unknownError'))
    } finally {
      setDeletingDocId(null)
    }
  }

  if (notFound) {
    return (
      <div className="flex flex-col gap-4">
        <Alert className="px-4 py-3 text-sm">{t('ws.notFound')}</Alert>
        <Link to="/dashboard" className="w-fit text-sm text-fg-soft transition-colors hover:text-accent-text">
          {t('ws.back')}
        </Link>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-8">
      <div>
        <Breadcrumb
          items={[{ label: t('ws.back'), to: '/dashboard' }, { label: name ?? t('ws.loading') }]}
        />
        <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
          <h1 className="text-3xl font-semibold tracking-tight">
            {name ?? t('ws.loading')}
          </h1>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setRenaming((v) => !v)}
            >
              {t('ws.rename')}
            </Button>
            <Button
              variant="danger"
              size="sm"
              disabled={deleting}
              onClick={() => void onDeleteWorkspace()}
            >
              {deleting ? t('ws.deleting') : t('ws.delete')}
            </Button>
          </div>
        </div>

        {renaming && (
          <form onSubmit={onRename} className="mt-4 flex items-end gap-2">
            <label className="flex flex-col gap-1 text-sm">
              <span className="label">{t('ws.renameTitle')}</span>
              <input
                type="text"
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                maxLength={120}
                className="rounded-md border border-line-strong bg-bg px-3 py-2 text-sm"
              />
            </label>
            <Button type="submit" variant="accent" disabled={renaming}>
              {t('ws.save')}
            </Button>
          </form>
        )}
      </div>

      {error && <Alert className="px-3 py-2 text-sm">{error}</Alert>}

      <section
        aria-labelledby="ws-upload-heading"
        className="rounded-lg border border-line bg-surface p-5"
      >
        <h2
          id="ws-upload-heading"
          className="text-lg font-semibold tracking-tight"
        >
          {t('ws.uploadTitle')}
        </h2>
        <form onSubmit={c.onSubmit} className="mt-4">
          <DropZone file={c.file} onPick={c.pick} />
          <ConvertOptions
            scanImages={c.scanImages}
            onScanImages={c.setScanImages}
            extractImages={c.extractImages}
            onExtractImages={c.setExtractImages}
            ocrImages={c.ocrImages}
            onOcrImages={c.setOcrImages}
            ocrScope={c.ocrScope}
            onOcrScope={c.setOcrScope}
            file={c.file}
          />
          <div aria-live="polite" className="mt-3 min-h-6 text-sm">
            {c.error && <Alert className="px-3 py-2">{c.error}</Alert>}
            {c.pending && !c.error && (
              <p className="flex items-center gap-2 text-fg-soft">
                <Spinner className="h-4 w-4" />
                {c.progress ?? t('upload.pendingMsg')}
              </p>
            )}
          </div>
          <Button
            type="submit"
            variant="accent"
            disabled={c.pending || !c.file}
            aria-busy={c.pending}
            className="mt-1 w-full disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-fg-faint"
          >
            {c.pending
              ? t('upload.submitBusy')
              : c.file
                ? t('upload.submitConvert')
                : t('upload.submitIdle')}
          </Button>
        </form>
      </section>

      <section aria-labelledby="ws-docs-heading">
        <h2
          id="ws-docs-heading"
          className="border-b border-line pb-2 text-lg font-semibold tracking-tight"
        >
          {t('ws.docsTitle')}
          {docs && (
            <span className="ml-2 font-mono text-sm font-normal text-fg-soft">
              {docs.length}
            </span>
          )}
        </h2>
        {docs === null ? (
          <p className="flex items-center gap-2 py-6 text-sm text-fg-soft">
            <Spinner className="h-4 w-4" /> {t('ws.loading')}
          </p>
        ) : docs.length === 0 ? (
          <p className="py-6 text-sm text-fg-soft">{t('ws.empty')}</p>
        ) : (
          <ul className="divide-y divide-line">
            {docs.map((d) => (
              <DocumentListItem
                key={d.doc_id}
                doc={d}
                workspaceId={workspaceId}
                deleting={deletingDocId === d.doc_id}
                onDelete={(doc) => void onDeleteDoc(doc)}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
