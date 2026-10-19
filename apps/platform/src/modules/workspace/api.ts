import { apiFetch, errDetail } from '../../lib/api'
import { t } from '../../lib/i18n'
import type { DocSummary } from '../library/api'

export interface Workspace {
  id: string
  ownerId: string
  name: string
  createdAt: string
  documentCount?: number
}

async function asError(res: Response, fallback: string): Promise<Error> {
  const detail = await res.text().catch(() => '')
  return new Error(errDetail(detail, fallback))
}

export async function listWorkspaces(): Promise<Workspace[]> {
  const res = await apiFetch('/v1/workspaces')
  if (!res.ok) throw await asError(res, t('api.errWorkspaces', { status: res.status }))
  const body = (await res.json()) as { workspaces: Workspace[] }
  return body.workspaces ?? []
}

export async function getWorkspace(id: string): Promise<Workspace> {
  const res = await apiFetch(`/v1/workspaces/${id}`)
  if (!res.ok) throw await asError(res, t('api.errWorkspaces', { status: res.status }))
  const body = (await res.json()) as { workspace: Workspace }
  return body.workspace
}

export async function createWorkspace(name: string): Promise<Workspace> {  const res = await apiFetch('/v1/workspaces', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  if (!res.ok) throw await asError(res, t('api.errWorkspaces', { status: res.status }))
  const body = (await res.json()) as { workspace: Workspace }
  return body.workspace
}

export async function renameWorkspace(id: string, name: string): Promise<Workspace> {
  const res = await apiFetch(`/v1/workspaces/${id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  if (!res.ok) throw await asError(res, t('api.errWorkspaces', { status: res.status }))
  const body = (await res.json()) as { workspace: Workspace }
  return body.workspace
}

export async function deleteWorkspace(id: string): Promise<void> {
  const res = await apiFetch(`/v1/workspaces/${id}`, { method: 'DELETE' })
  if (!res.ok) throw await asError(res, t('api.errWorkspaces', { status: res.status }))
}

export async function listWorkspaceDocuments(id: string): Promise<DocSummary[]> {
  const res = await apiFetch(`/v1/workspaces/${id}/documents`)
  if (!res.ok) throw await asError(res, t('api.errDocs', { status: res.status }))
  const body = (await res.json()) as { documents: DocSummary[] }
  return body.documents ?? []
}
