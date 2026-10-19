import { Link } from '@tanstack/react-router'
import { localeTag, useI18n } from '../../lib/i18n'
import type { DocSummary } from './api'

function formatDate(iso?: string): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString(localeTag())
}

export function DocumentListItem({
  doc,
  deleting,
  onDelete,
  workspaceId,
}: {
  doc: DocSummary
  deleting: boolean
  onDelete: (doc: DocSummary) => void
  /** When set, the row links to the workspace-scoped doc page. */
  workspaceId?: string
}) {
  const { t } = useI18n()
  const link = workspaceId
    ? ({ to: '/w/$workspaceId/d/$docId', params: { workspaceId, docId: doc.doc_id } } as const)
    : ({ to: '/r/$docId', params: { docId: doc.doc_id } } as const)
  return (
    <li className="group flex items-center">
      <Link
        {...link}
        className="min-w-0 flex-1 py-3.5 pr-4"
      >
        <span className="block truncate font-medium transition-colors group-hover:text-accent-text">
          {doc.filename ?? doc.doc_id}
        </span>
        <span className="mt-1 block font-mono text-[11px] text-fg-soft">
          {doc.stats ? `${doc.stats.pages} ${t('result.statPages').toLowerCase()} · ${doc.stats.tables} ${t('result.statTables').toLowerCase()} · ` : ''}
          {formatDate(doc.created_at)}
        </span>
      </Link>
      <button
        type="button"
        onClick={() => onDelete(doc)}
        disabled={deleting}
        aria-label={`${t('common.delete')} ${doc.filename ?? doc.doc_id}`}
        className="shrink-0 rounded-md px-2.5 py-1.5 text-sm text-fg-soft transition-colors hover:bg-danger/10 hover:text-danger disabled:opacity-40"
      >
        {deleting ? t('library.deleting') : t('common.delete')}
      </button>
    </li>
  )
}
