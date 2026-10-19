import { deleteDocument } from '../documents/service.js'
import {
  createWorkspace,
  deleteWorkspaceRow,
  findOwnedMentionableDocs,
  findOwnedWorkspace,
  listMentionableDocuments,
  listOwnerDocuments,
  listOwnerLandingDocuments,
  listWorkspaceDocuments,
  listWorkspaces,
  renameWorkspace,
  workspaceDocIds,
  type DocSummary,
  type MentionableDoc,
  type WorkspaceRow,
} from './store.js'

export type { DocSummary, MentionableDoc, WorkspaceRow }

export async function getWorkspaces(ownerId: string): Promise<WorkspaceRow[]> {
  return listWorkspaces(ownerId)
}

export async function addWorkspace(
  ownerId: string,
  name: string,
): Promise<WorkspaceRow> {
  return createWorkspace(ownerId, name)
}

export async function getWorkspace(
  id: string,
  ownerId: string,
): Promise<WorkspaceRow | null> {
  return findOwnedWorkspace(id, ownerId)
}

export async function updateWorkspace(
  id: string,
  ownerId: string,
  name: string,
): Promise<WorkspaceRow | null> {
  const owned = await findOwnedWorkspace(id, ownerId)
  if (!owned) return null
  await renameWorkspace(id, name)
  return { ...owned, name }
}

export async function getWorkspaceDocuments(
  id: string,
  ownerId: string,
): Promise<DocSummary[] | null> {
  const owned = await findOwnedWorkspace(id, ownerId)
  if (!owned) return null
  return listWorkspaceDocuments(id)
}

export async function getOwnerDocuments(ownerId: string): Promise<DocSummary[]> {
  return listOwnerDocuments(ownerId)
}

/** Landing-page docs for a logged-in user (no workspace). */
export async function getOwnerLandingDocuments(
  ownerId: string,
): Promise<DocSummary[]> {
  return listOwnerLandingDocuments(ownerId)
}

/** Cross-workspace `@` picker candidates for one owner. */
export async function getMentionableDocuments(
  ownerId: string,
  query: string,
  excludeDocId?: string,
): Promise<MentionableDoc[]> {
  return listMentionableDocuments(ownerId, query, excludeDocId)
}

/** Mention ids resolved to owned, indexed workspace docs (order preserved). */
export async function getOwnedMentionableDocs(
  ownerId: string,
  docIds: string[],
): Promise<MentionableDoc[]> {
  const docs = await findOwnedMentionableDocs(ownerId, docIds)
  const byId = new Map(docs.map((d) => [d.doc_id, d]))
  return docIds
    .map((id) => byId.get(id))
    .filter((d): d is MentionableDoc => Boolean(d))
}

/**
 * Delete a workspace and every document in it. Docs are removed through the
 * same path as `DELETE /v1/documents/:docId` (artifact files + Postgres rows +
 * Qdrant vectors + chat memory) before the workspace row itself, because
 * Document.workspace uses onDelete: Restrict.
 */
export async function removeWorkspace(
  id: string,
  ownerId: string,
): Promise<boolean> {
  const owned = await findOwnedWorkspace(id, ownerId)
  if (!owned) return false
  const docIds = await workspaceDocIds(id)
  for (const docId of docIds) {
    await deleteDocument(docId)
  }
  await deleteWorkspaceRow(id)
  return true
}
