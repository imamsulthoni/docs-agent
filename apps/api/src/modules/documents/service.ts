import {
  deleteArtifact,
  listGuestArtifacts,
  readPublicFile,
  type ArtifactMeta,
  type StoredFile,
} from './artifacts.js'
import { deleteDocCascade } from './store.js'

/** Anonymous landing-page listing (owner-less, non-workspace docs only). */
export async function listDocuments(): Promise<ArtifactMeta[]> {
  return listGuestArtifacts()
}

export async function getMarkdownDownload(docId: string): Promise<StoredFile | null> {
  return readPublicFile(`${docId}/doc.md`)
}

/** Delete files first, then best-effort database and vector cleanup. */
export async function deleteDocument(docId: string): Promise<void> {
  await deleteArtifact(docId)
  try {
    await deleteDocCascade(docId)
  } catch (err) {
    console.warn('cascade delete failed', err)
  }
}
