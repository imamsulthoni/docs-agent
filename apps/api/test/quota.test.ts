import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';

const root = await mkdtemp(path.join(os.tmpdir(), 'docsagent-quota-'));
process.env.ARTIFACT_DIR = root;
// ~1 KB quota so tests stay small; config reads env at import time.
process.env.ACCOUNT_QUOTA_MB = '0.001';
process.env.DATABASE_URL ??=
  'postgresql://postgres:postgres@127.0.0.1:15433/postgres';

const { prisma } = await import('../src/utils/prisma.ts');
const quota = await import('../src/modules/documents/quota.ts');

const suffix = Math.random().toString(36).slice(2, 10);
const ownerA = `u:quotaA${suffix}`;
const ownerB = `u:quotaB${suffix}`;
const ownerC = `u:quotaC${suffix}`;
const docA = 'a'.repeat(31) + '1';
const docB = 'b'.repeat(31) + '2';
const docC = 'c'.repeat(31) + '3';

describe('account storage quota', () => {
  before(async () => {
    await prisma.chatAttachment.deleteMany({
      where: { ownerId: { in: [ownerA, ownerB, ownerC] } },
    });
    await prisma.document.deleteMany({
      where: { id: { in: [docA, docB, docC] } },
    });
  });

  after(async () => {
    await prisma.chatAttachment.deleteMany({
      where: { ownerId: { in: [ownerA, ownerB, ownerC] } },
    });
    await prisma.document.deleteMany({
      where: { id: { in: [docA, docB, docC] } },
    });
    await prisma.$disconnect();
    await rm(root, { recursive: true, force: true });
  });

  test('usage sums document bytes + non-deleted attachment bytes', async () => {
    await prisma.document.create({
      data: { id: docA, name: 'a.pdf', ownerId: ownerA, sizeBytes: 300 },
    });
    const attachment = await prisma.chatAttachment.create({
      data: {
        ownerId: ownerA,
        docId: docA,
        filename: 'a.txt',
        mimeType: 'text/plain',
        sizeBytes: 200,
        status: 'ready',
      },
    });

    const usage = await quota.getOwnerUsage(ownerA);
    assert.deepEqual(usage, {
      usedBytes: 500,
      documentsBytes: 300,
      attachmentsBytes: 200,
    });

    // Soft delete releases the attachment bytes immediately.
    await prisma.chatAttachment.update({
      where: { id: attachment.id },
      data: { status: 'deleted', markdown: null },
    });
    const afterDelete = await quota.getOwnerUsage(ownerA);
    assert.equal(afterDelete.attachmentsBytes, 0);
    assert.equal(afterDelete.usedBytes, 300);
  });

  test('reserveStorage blocks once the quota is exceeded', async () => {
    const first = await quota.reserveStorage(ownerB, 600, (db) =>
      db.chatAttachment.create({
        data: {
          ownerId: ownerB,
          docId: docB,
          filename: 'one.txt',
          mimeType: 'text/plain',
          sizeBytes: 600,
          status: 'ready',
        },
      }),
    );
    assert.equal(first.ok, true);

    const second = await quota.reserveStorage(ownerB, 600, (db) =>
      db.chatAttachment.create({
        data: {
          ownerId: ownerB,
          docId: docB,
          filename: 'two.txt',
          mimeType: 'text/plain',
          sizeBytes: 600,
          status: 'ready',
        },
      }),
    );
    assert.equal(second.ok, false);
    if (!second.ok) assert.equal(second.usedBytes, 600);

    // Nothing was inserted for the rejected reservation.
    const rows = await prisma.chatAttachment.count({
      where: { ownerId: ownerB },
    });
    assert.equal(rows, 1);
  });

  test('assertWithinQuota throws QuotaExceededError', async () => {
    await prisma.document.create({
      data: { id: docC, name: 'c.pdf', ownerId: ownerC, sizeBytes: 1_000 },
    });
    await assert.rejects(
      () => quota.assertWithinQuota(ownerC, 100),
      quota.QuotaExceededError,
    );
    await assert.doesNotReject(() => quota.assertWithinQuota(ownerC, 0));
  });
});
