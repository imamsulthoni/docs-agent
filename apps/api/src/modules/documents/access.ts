import { prisma } from '../../utils/prisma.js'
import { readArtifactMeta } from './artifacts.js'

/**
 * Owner identity (`u:<id>`) of a document. The Postgres row is authoritative;
 * `meta.json` covers guest-era docs that never got a row. Guests own nothing,
 * so a missing owner means the document is open (opaque docId + expiry).
 */
export async function resolveDocOwner(docId: string): Promise<string | null> {
  const [row, meta] = await Promise.all([
    prisma.document.findUnique({
      where: { id: docId },
      select: { ownerId: true },
    }),
    readArtifactMeta(docId),
  ])
  return row?.ownerId ?? meta?.owner_id ?? null
}

/** Pure ownership rule shared by file, download, delete and chat routes. */
export function canAccessDoc(
  identity: string | null,
  ownerId: string | null,
): boolean {
  return ownerId === null || identity === ownerId
}

/** 404-friendly check: callers must not reveal that a private doc exists. */
export async function isDocAccessible(
  docId: string,
  identity: string | null,
): Promise<boolean> {
  return canAccessDoc(identity, await resolveDocOwner(docId))
}
