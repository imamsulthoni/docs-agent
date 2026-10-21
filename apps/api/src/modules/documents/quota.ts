import { ACCOUNT_QUOTA_BYTES, ACCOUNT_QUOTA_MB } from '../../config.js'
import { prisma } from '../../utils/prisma.js'
import type { Prisma } from '../../generated/prisma/client.js'

type Db = Prisma.TransactionClient | typeof prisma

export type OwnerUsage = {
  usedBytes: number
  documentsBytes: number
  attachmentsBytes: number
}

export class QuotaExceededError extends Error {
  constructor(readonly usedBytes: number) {
    super(
      `Account storage quota exceeded (${ACCOUNT_QUOTA_MB} MB). Delete documents to free space.`,
    )
    this.name = 'QuotaExceededError'
  }
}

/**
 * Storage used by one account. Documents contribute their artifact folder
 * bytes; attachments contribute the uploaded size (their extracted text lives
 * in Postgres and is already bounded by ATTACH_MAX_CHARS). Soft-deleted
 * attachments release their quota immediately.
 */
export async function getOwnerUsage(
  ownerId: string,
  db: Db = prisma,
): Promise<OwnerUsage> {
  const [documents, attachments] = await Promise.all([
    db.document.aggregate({
      where: { ownerId },
      _sum: { sizeBytes: true },
    }),
    db.chatAttachment.aggregate({
      where: { ownerId, status: { not: 'deleted' } },
      _sum: { sizeBytes: true },
    }),
  ])
  const documentsBytes = documents._sum.sizeBytes ?? 0
  const attachmentsBytes = attachments._sum.sizeBytes ?? 0
  return {
    usedBytes: documentsBytes + attachmentsBytes,
    documentsBytes,
    attachmentsBytes,
  }
}

export function isOverQuota(
  usedBytes: number,
  incomingBytes = 0,
): boolean {
  if (ACCOUNT_QUOTA_BYTES <= 0) return false
  return usedBytes + incomingBytes > ACCOUNT_QUOTA_BYTES
}

/** Fast pre-check before a conversion/upload starts. */
export async function assertWithinQuota(
  ownerId: string,
  incomingBytes = 0,
): Promise<void> {
  if (ACCOUNT_QUOTA_BYTES <= 0) return
  const usage = await getOwnerUsage(ownerId)
  if (isOverQuota(usage.usedBytes, incomingBytes)) {
    throw new QuotaExceededError(usage.usedBytes)
  }
}

/**
 * Serialize the final quota check per owner with a Postgres advisory lock so
 * two concurrent uploads cannot both slip under the limit.
 */
export async function withOwnerStorageLock<T>(
  ownerId: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    // `pg_advisory_xact_lock` returns void, which Prisma cannot deserialize;
    // cast it to text so the blocking lock can run through $queryRaw.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${ownerId}))::text`
    return fn(tx)
  })
}

/**
 * Check-and-insert for rows that count against the quota. The insert runs in
 * the same transaction as the check, so the owner can never exceed the limit.
 */
export async function reserveStorage<T>(
  ownerId: string,
  incomingBytes: number,
  create: (db: Db) => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; usedBytes: number }> {
  if (ACCOUNT_QUOTA_BYTES <= 0) {
    return { ok: true, value: await create(prisma) }
  }
  return withOwnerStorageLock(ownerId, async (tx) => {
    const usage = await getOwnerUsage(ownerId, tx)
    if (isOverQuota(usage.usedBytes, incomingBytes)) {
      return { ok: false as const, usedBytes: usage.usedBytes }
    }
    return { ok: true as const, value: await create(tx) }
  })
}
