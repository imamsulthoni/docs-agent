import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';

const root = await mkdtemp(path.join(os.tmpdir(), 'docsagent-access-'));
process.env.ARTIFACT_DIR = root;
process.env.DATABASE_URL ??=
  'postgresql://postgres:postgres@127.0.0.1:15433/postgres';

const artifacts = await import('../src/modules/documents/artifacts.ts');
const { prisma } = await import('../src/utils/prisma.ts');
const access = await import('../src/modules/documents/access.ts');

const suffix = Math.random().toString(36).slice(2, 10);
const ownerA = `u:ownerA${suffix}`;
const ownerB = `u:ownerB${suffix}`;
const rowDoc = '1'.repeat(31) + 'a';
const metaDoc = '2'.repeat(31) + 'b';
const guestDoc = '3'.repeat(31) + 'c';

describe('document access rule', () => {
  test('guest docs are open, owned docs need the exact identity', () => {
    assert.equal(access.canAccessDoc(null, null), true);
    assert.equal(access.canAccessDoc(ownerA, null), true);
    assert.equal(access.canAccessDoc(ownerA, ownerA), true);
    assert.equal(access.canAccessDoc(ownerA, ownerB), false);
    assert.equal(access.canAccessDoc(null, ownerA), false);
  });
});

describe('document owner resolution', () => {
  before(async () => {
    await prisma.document.deleteMany({
      where: { id: { in: [rowDoc, metaDoc, guestDoc] } },
    });
    await prisma.document.create({
      data: { id: rowDoc, name: 'row.pdf', ownerId: ownerA },
    });
    await artifacts.putArtifact({
      doc_id: metaDoc,
      markdown: '## Page 1\n',
      owner_id: ownerB,
      workspace_id: 'ws_meta',
    });
    await artifacts.putArtifact({
      doc_id: guestDoc,
      markdown: '## Page 1\n',
    });
  });

  after(async () => {
    await prisma.document.deleteMany({
      where: { id: { in: [rowDoc, metaDoc, guestDoc] } },
    });
    await prisma.$disconnect();
    await rm(root, { recursive: true, force: true });
  });

  test('Postgres row wins, meta covers docs without a row', async () => {
    assert.equal(await access.resolveDocOwner(rowDoc), ownerA);
    assert.equal(await access.resolveDocOwner(metaDoc), ownerB);
    assert.equal(await access.resolveDocOwner(guestDoc), null);
  });

  test('isDocAccessible rejects other owners and guests on private docs', async () => {
    assert.equal(await access.isDocAccessible(rowDoc, ownerA), true);
    assert.equal(await access.isDocAccessible(rowDoc, ownerB), false);
    assert.equal(await access.isDocAccessible(rowDoc, null), false);
    assert.equal(await access.isDocAccessible(metaDoc, ownerB), true);
    assert.equal(await access.isDocAccessible(metaDoc, ownerA), false);
    assert.equal(await access.isDocAccessible(guestDoc, null), true);
  });
});
