import { apiFetch, errDetail } from '../../lib/api'
import { t } from '../../lib/i18n'

export interface DocSummary {
  doc_id: string
  markdown_url: string
  filename?: string
  created_at?: string
  expires_at?: string
  stats?: {
    pages: number
    scanned_pages: number
    tables: number
    images_kept: number
    images_skipped: number
  }
  warnings?: string[]
  isProcessed?: boolean
  workspace_id?: string | null
}

/**
 * List documents. `landing` scopes the request to the anonymous landing
 * library (workspace docs excluded); omit it for the full owner listing.
 */
export async function listDocuments(
  scope?: 'landing',
): Promise<DocSummary[]> {
  const res = await apiFetch(
    scope ? `/v1/documents?scope=${scope}` : '/v1/documents',
  )
  if (!res.ok) throw new Error(t('api.errDocs', { status: res.status }))
  const body = (await res.json()) as { documents: DocSummary[] }
  return body.documents ?? []
}

export async function deleteDocument(docId: string): Promise<void> {
  const res = await apiFetch(`/v1/documents/${docId}`, { method: 'DELETE' })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(errDetail(detail, t('api.errDeleteDoc', { status: res.status })))
  }
}
