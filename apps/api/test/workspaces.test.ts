import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';

const root = await mkdtemp(path.join(os.tmpdir(), 'docsagent-workspaces-'));
process.env.ARTIFACT_DIR = root;
process.env.DATABASE_URL ??=
  'postgresql://postgres:postgres@127.0.0.1:15433/postgres';

const artifacts = await import('../src/modules/documents/artifacts.ts');
const { prisma } = await import('../src/utils/prisma.ts');
const ws = await import('../src/modules/workspaces/service.ts');
const { parseWorkspaceName } = await import('../src/modules/workspaces/utils.ts');

const suffix = Math.random().toString(36).slice(2, 10);
const ownerA = `u:testA${suffix}`;
const ownerB = `u:testB${suffix}`;
const docA = '1'.repeat(31) + 'a';
const docB = '2'.repeat(31) + 'b';
const docC = '3'.repeat(31) + 'c';
const docD = '4'.repeat(31) + 'd';

describe('workspace names', () => {
  test('trims, rejects empty and over-long names', () => {
    assert.deepEqual(parseWorkspaceName({ name: '  Legal  ' }), {
      ok: true,
      name: 'Legal',
    });
    assert.equal(parseWorkspaceName({ name: '   ' }).ok, false);
    assert.equal(parseWorkspaceName({}).ok, false);
    assert.equal(parseWorkspaceName({ name: 'x'.repeat(200) }).ok, false);
  });
});

describe('workspace isolation & cascade delete', () => {
  before(async () => {
    await prisma.document.deleteMany({
      where: { id: { in: [docA, docB, docC, docD] } },
    });
  });

  after(async () => {
    await prisma.document.deleteMany({
      where: { id: { in: [docA, docB, docC, docD] } },
    });
    await prisma.workspace.deleteMany({
      where: { ownerId: { in: [ownerA, ownerB] } },
    });
    await prisma.$disconnect();
    await rm(root, { recursive: true, force: true });
  });

  test('documents are listed only inside their own workspace', async () => {
    const a = await ws.addWorkspace(ownerA, 'Alpha');
    const b = await ws.addWorkspace(ownerB, 'Beta');

    await artifacts.putArtifact({
      doc_id: docA,
      markdown: '## Page 1\nA\n',
      owner_id: ownerA,
      workspace_id: a.id,
    });
    await prisma.document.create({
      data: { id: docA, name: 'a.pdf', ownerId: ownerA, workspaceId: a.id },
    });
    await prisma.document.create({
      data: { id: docB, name: 'b.pdf', ownerId: ownerB, workspaceId: b.id },
    });

    const aDocs = await ws.getWorkspaceDocuments(a.id, ownerA);
    assert.equal(aDocs?.length, 1);
    assert.equal(aDocs?.[0]?.doc_id, docA);

    // B's workspace is invisible to A (owner-scoped).
    assert.equal(await ws.getWorkspaceDocuments(b.id, ownerA), null);
    // A's own docs across workspaces.
    const ownerDocs = await ws.getOwnerDocuments(ownerA);
    assert.deepEqual(
      ownerDocs.map((d) => d.doc_id),
      [docA],
    );
  });

  test('landing listing excludes workspace documents', async () => {
    await prisma.document.create({
      data: { id: docD, name: 'd.pdf', ownerId: ownerA, workspaceId: null },
    });

    const landing = await ws.getOwnerLandingDocuments(ownerA);
    assert.deepEqual(
      landing.map((d) => d.doc_id),
      [docD],
    );

    // The dashboard-wide listing still includes both.
    const all = await ws.getOwnerDocuments(ownerA);
    assert.deepEqual(
      all.map((d) => d.doc_id).sort(),
      [docA, docD].sort(),
    );
  });

  test('deleting a workspace removes its documents and artifacts', async () => {
    const a = await ws.addWorkspace(ownerA, 'ToDelete');
    await artifacts.putArtifact({
      doc_id: docC,
      markdown: '## Page 1\nC\n',
      owner_id: ownerA,
      workspace_id: a.id,
    });
    await prisma.document.create({
      data: { id: docC, name: 'c.pdf', ownerId: ownerA, workspaceId: a.id },
    });

    // Wrong owner cannot delete.
    assert.equal(await ws.removeWorkspace(a.id, ownerB), false);
    assert.ok(await ws.getWorkspace(a.id, ownerA));

    assert.equal(await ws.removeWorkspace(a.id, ownerA), true);
    assert.equal(await ws.getWorkspace(a.id, ownerA), null);
    assert.equal(await prisma.document.findUnique({ where: { id: docC } }), null);
    assert.equal(await artifacts.readMarkdown(docC), null);
  });
});
