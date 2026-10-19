import { apiFetch } from '../../lib/api'
import { t } from '../../lib/i18n'

export async function fetchMarkdown(docId: string): Promise<string> {
  // Credentialed so private (workspace-owned) docs pass the /public owner gate.
  const res = await apiFetch(`/public/${docId}/doc.md`)
  if (!res.ok) {
    const dl = await apiFetch(`/v1/download/${docId}`)
    if (!dl.ok) throw new Error(t('api.errMarkdown'))
    return dl.text()
  }
  return res.text()
}
