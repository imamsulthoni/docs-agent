import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';

const root = await mkdtemp(path.join(os.tmpdir(), 'docsagent-mentions-'));
process.env.ARTIFACT_DIR = root;
process.env.DATABASE_URL ??=
  'postgresql://postgres:postgres@127.0.0.1:15433/postgres';

const { prisma } = await import('../src/utils/prisma.ts');
const ws = await import('../src/modules/workspaces/service.ts');
const { parseMentionHeader } = await import('../src/modules/chat/utils.ts');
const { resolveMentions, limitRetrievedPages } = await import(
  '../src/modules/chat/service.ts'
);

const suffix = Math.random().toString(36).slice(2, 10);
const ownerA = `u:mentionA${suffix}`;
const ownerB = `u:mentionB${suffix}`;
const activeDoc = '7a'.repeat(16);
const workspaceDoc = '7b'.repeat(16);
const secondWorkspaceDoc = '7c'.repeat(16);
const landingDoc = '7d'.repeat(16);
const foreignDoc = '7e'.repeat(16);
const unindexedDoc = '7f'.repeat(16);
const allDocs = [
  activeDoc,
  workspaceDoc,
  secondWorkspaceDoc,
  landingDoc,
  foreignDoc,
  unindexedDoc,
];

describe('mention header parsing', () => {
  test('empty header means no mentions', () => {
    assert.deepEqual(parseMentionHeader(undefined, activeDoc, false), {
      ok: true,
      docIds: [],
    });
  });

  test('rejects guests even when they forge the header', () => {
    const parsed = parseMentionHeader(workspaceDoc, activeDoc, true);
    assert.equal(parsed.ok, false);
    if (!parsed.ok) assert.equal(parsed.status, 403);
  });

  test('rejects malformed ids', () => {
    const parsed = parseMentionHeader('not-a-doc-id', activeDoc, false);
    assert.equal(parsed.ok, false);
    if (!parsed.ok) assert.equal(parsed.status, 400);
  });

  test('dedupes and drops the active document', () => {
    const parsed = parseMentionHeader(
      `${workspaceDoc}, ${workspaceDoc}, ${activeDoc}`,
      activeDoc,
      false,
    );
    assert.deepEqual(parsed, { ok: true, docIds: [workspaceDoc] });
  });

  test('caps mentions at three', () => {
    const four = [workspaceDoc, secondWorkspaceDoc, landingDoc, unindexedDoc];
    const parsed = parseMentionHeader(four.join(','), activeDoc, false);
    assert.equal(parsed.ok, false);
    if (!parsed.ok) assert.equal(parsed.status, 422);
  });
});

describe('mentionable documents', () => {
  before(async () => {
    await prisma.document.deleteMany({ where: { id: { in: allDocs } } });
    await prisma.workspace.deleteMany({
      where: { ownerId: { in: [ownerA, ownerB] } },
    });
    const alpha = await ws.addWorkspace(ownerA, 'Alpha');
    const beta = await ws.addWorkspace(ownerA, 'Beta');
    const other = await ws.addWorkspace(ownerB, 'Other');

    await prisma.document.createMany({
      data: [
        {
          id: activeDoc,
          name: 'active.pdf',
          ownerId: ownerA,
          workspaceId: alpha.id,
          isProcessed: true,
        },
        {
          id: workspaceDoc,
          name: 'Contract A.pdf',
          ownerId: ownerA,
          workspaceId: alpha.id,
          isProcessed: true,
        },
        {
          id: secondWorkspaceDoc,
          name: 'Invoice B.pdf',
          ownerId: ownerA,
          workspaceId: beta.id,
          isProcessed: true,
        },
        {
          id: landingDoc,
          name: 'landing.pdf',
          ownerId: ownerA,
          workspaceId: null,
          isProcessed: true,
        },
        {
          id: foreignDoc,
          name: 'foreign.pdf',
          ownerId: ownerB,
          workspaceId: other.id,
          isProcessed: true,
        },
        {
          id: unindexedDoc,
          name: 'pending.pdf',
          ownerId: ownerA,
          workspaceId: alpha.id,
          isProcessed: false,
        },
      ],
    });
  });

  after(async () => {
    await prisma.document.deleteMany({ where: { id: { in: allDocs } } });
    await prisma.workspace.deleteMany({
      where: { ownerId: { in: [ownerA, ownerB] } },
    });
    await prisma.$disconnect();
    await rm(root, { recursive: true, force: true });
  });

  test('lists owned, indexed workspace docs across workspaces', async () => {
    const docs = await ws.getMentionableDocuments(ownerA, '', activeDoc);
    assert.deepEqual(
      docs.map((d) => d.doc_id).sort(),
      [workspaceDoc, secondWorkspaceDoc].sort(),
    );
    const names = new Set(docs.map((d) => d.workspace_name));
    assert.deepEqual([...names].sort(), ['Alpha', 'Beta']);
  });

  test('excludes landing docs, unindexed docs and other owners', async () => {
    const docs = await ws.getMentionableDocuments(ownerA, '');
    const ids = docs.map((d) => d.doc_id);
    assert.equal(ids.includes(landingDoc), false);
    assert.equal(ids.includes(unindexedDoc), false);
    assert.equal(ids.includes(foreignDoc), false);
  });

  test('filters by name query', async () => {
    const docs = await ws.getMentionableDocuments(ownerA, 'invoice');
    assert.deepEqual(
      docs.map((d) => d.doc_id),
      [secondWorkspaceDoc],
    );
  });

  test('resolves owned mentions in request order', async () => {
    const resolved = await resolveMentions(ownerA, [
      secondWorkspaceDoc,
      workspaceDoc,
    ]);
    assert.equal(resolved.ok, true);
    if (!resolved.ok) return;
    assert.deepEqual(
      resolved.mentions.map((m) => m.docId),
      [secondWorkspaceDoc, workspaceDoc],
    );
    assert.equal(resolved.mentions[0]?.documentName, 'Invoice B.pdf');
  });

  test('rejects foreign, landing and unindexed ids with a generic 403', async () => {
    for (const id of [foreignDoc, landingDoc, unindexedDoc]) {
      const resolved = await resolveMentions(ownerA, [id]);
      assert.equal(resolved.ok, false);
      if (!resolved.ok) assert.equal(resolved.status, 403);
    }
  });
});

describe('retrieval budget', () => {
  const page = (docId: string, pageNumber: number) => ({
    docId,
    documentName: docId,
    pageNumber,
    content: `p${pageNumber}`,
  });

  test('caps per document and keeps the active document first', () => {
    const perDoc = new Map([
      [activeDoc, Array.from({ length: 10 }, (_, i) => page(activeDoc, i + 1))],
      [
        workspaceDoc,
        Array.from({ length: 10 }, (_, i) => page(workspaceDoc, i + 1)),
      ],
    ]);
    const docs = [
      { docId: workspaceDoc, documentName: 'Mention' },
      { docId: activeDoc, documentName: 'Active', active: true },
    ];
    const pages = limitRetrievedPages(perDoc, docs, 10);
    assert.equal(pages.length, 7); // 4 active + 3 mention
    assert.equal(pages[0]?.docId, activeDoc);
  });

  test('never exceeds the global page budget', () => {
    const perDoc = new Map(
      [activeDoc, workspaceDoc, secondWorkspaceDoc].map((id) => [
        id,
        Array.from({ length: 5 }, (_, i) => page(id, i + 1)),
      ]),
    );
    const docs = [
      { docId: activeDoc, documentName: 'Active', active: true },
      { docId: workspaceDoc, documentName: 'A' },
      { docId: secondWorkspaceDoc, documentName: 'B' },
    ];
    assert.equal(limitRetrievedPages(perDoc, docs, 5).length, 5);
  });
});
