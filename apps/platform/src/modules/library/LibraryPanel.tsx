import { useEffect, useState } from 'react'
import { useI18n } from '../../lib/i18n'
import { useConfirm } from '../../components/ConfirmDialog'
import { Alert } from '../../components/ui/Alert'
import { Button } from '../../components/ui/Button'
import { deleteDocument, listDocuments, type DocSummary } from './api'
import { DocumentListItem } from './DocumentListItem'
import { forgetAllDocSessions } from '../chat/sessions'

/** Self-contained document library: fetches, lists, and deletes converted docs. */
export function LibraryPanel() {
  const confirm = useConfirm()
  const { t } = useI18n()
  const [docs, setDocs] = useState<DocSummary[] | null>(null)
  const [docsError, setDocsError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  async function loadDocs() {
    setRefreshing(true)
    setDocsError(null)
    try {
      setDocs(await listDocuments('landing'))
    } catch (err) {
      setDocsError(err instanceof Error ? err.message : t('common.unknownError'))
    } finally {
      setRefreshing(false)
    }
  }

  useEffect(() => {
    void loadDocs()
  }, [])

  async function onDelete(doc: DocSummary) {
    const label = doc.filename ?? doc.doc_id
    const ok = await confirm({
      title: t('library.deleteTitle'),
      detail: label,
      description: t('library.deleteDesc'),
    })
    if (!ok) return
    setDocsError(null)
    setDeletingId(doc.doc_id)
    try {
      await deleteDocument(doc.doc_id)
      forgetAllDocSessions(doc.doc_id)
      setDocs((prev) => (prev ? prev.filter((d) => d.doc_id !== doc.doc_id) : prev))
    } catch (err) {
      setDocsError(err instanceof Error ? err.message : t('common.unknownError'))
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <section
      aria-labelledby="docs-heading"
      className="mt-6 border-t border-line pt-5"
    >
      <div className="flex items-end justify-between">
        <div>
          <p className="label">{t('library.step')}</p>
          <h2 id="docs-heading" className="mt-2 text-lg font-semibold tracking-tight">
            {t('library.title')}
            {docs && (
              <span className="ml-2 font-mono text-sm font-normal text-fg-soft">
                {docs.length}
              </span>
            )}
          </h2>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="text-fg"
          onClick={() => void loadDocs()}
          disabled={refreshing}
        >
          {refreshing ? t('library.refreshing') : t('library.refresh')}
        </Button>
      </div>
      <div aria-live="polite">
        {docs === null && !docsError && (
          <p className="py-8 text-sm text-fg-soft">{t('library.loading')}</p>
        )}
        {docsError && (
          <Alert className="mt-4 px-4 py-3 text-sm">{docsError}</Alert>
        )}
        {docs !== null && docs.length === 0 && (
          <p className="py-8 text-sm text-fg-soft">
            {t('library.empty')}
          </p>
        )}
        {docs !== null && docs.length > 0 && (
          <ul className="-mx-2 divide-y divide-line">
            {docs.map((d) => (
              <DocumentListItem
                key={d.doc_id}
                doc={d}
                deleting={deletingId === d.doc_id}
                onDelete={(doc) => void onDelete(doc)}
              />
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
