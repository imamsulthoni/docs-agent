import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';

const root = await mkdtemp(path.join(os.tmpdir(), 'docsagent-mention-history-'));
process.env.ARTIFACT_DIR = root;
process.env.DATABASE_URL ??=
  'postgresql://postgres:postgres@127.0.0.1:15433/postgres';

const { prisma } = await import('../src/utils/prisma.ts');
const { PrismaMemoryStore } = await import('@anvia/memory-prisma');
const { LeanHistoryStore } = await import(
  '../src/modules/chat/history-store.ts'
);
const { loadUiHistory } = await import('../src/modules/chat/service.ts');

const suffix = Math.random().toString(36).slice(2, 10);
const docId = '9a'.repeat(16);
const mentionedDocId = '9b'.repeat(16);
const deletedDocId = '9c'.repeat(16);
const sessionId = `doc:${docId}:s:mentiontest${suffix}`;
const userId = `u:mentionhistory${suffix}`;
let workspaceId = '';

function store(mentions: Array<{
  docId: string;
  workspaceId: string | null;
  documentName: string;
}>) {
  return new LeanHistoryStore(
    new PrismaMemoryStore({ client: prisma }),
    6,
    mentions,
  );
}

async function appendTurn(runId: string, turn: number, question: string) {
  const memory = store([
    {
      docId: mentionedDocId,
      workspaceId,
      documentName: 'Invoice B.pdf',
    },
    {
      docId: deletedDocId,
      workspaceId,
      documentName: 'Deleted.pdf',
    },
  ]);
  await memory.append({
    scope: { sessionId, userId },
    runId,
    turn,
    messages: [
      { role: 'user', content: [{ type: 'text', text: question }] },
    ],
  });
}

describe('mention chips in chat history', () => {
  before(async () => {
    await prisma.agentMemorySession.deleteMany({ where: { sessionId } });
    await prisma.chatMessageMention.deleteMany({ where: { sessionId } });
    await prisma.document.deleteMany({
      where: { id: { in: [mentionedDocId, deletedDocId] } },
    });
    await prisma.workspace.deleteMany({ where: { ownerId: userId } });
    const workspace = await prisma.workspace.create({
      data: { ownerId: userId, name: 'Mention History' },
    });
    workspaceId = workspace.id;
    await prisma.document.createMany({
      data: [
        {
          id: mentionedDocId,
          name: 'Invoice B.pdf',
          ownerId: userId,
          workspaceId,
          isProcessed: true,
        },
        {
          id: deletedDocId,
          name: 'Deleted.pdf',
          ownerId: userId,
          workspaceId,
          isProcessed: true,
        },
      ],
    });
  });

  after(async () => {
    await prisma.agentMemorySession.deleteMany({ where: { sessionId } });
    await prisma.chatMessageMention.deleteMany({ where: { sessionId } });
    await prisma.document.deleteMany({
      where: { id: { in: [mentionedDocId, deletedDocId] } },
    });
    await prisma.workspace.deleteMany({ where: { ownerId: userId } });
    await prisma.$disconnect();
    await rm(root, { recursive: true, force: true });
  });

  test('persists one row per mention and renders them on the user message', async () => {
    await appendTurn('run_mention_1', 1, 'Bandingkan dengan Invoice B');

    const rows = await prisma.chatMessageMention.findMany({
      where: { sessionId, runId: 'run_mention_1' },
    });
    assert.equal(rows.length, 2);

    const history = await loadUiHistory(sessionId, userId);
    const user = history.find((m) => m.role === 'user');
    assert.ok(user);
    const mentions = user?.metadata?.mentions ?? [];
    assert.deepEqual(
      mentions.map((m) => m.docId).sort(),
      [mentionedDocId, deletedDocId].sort(),
    );
    assert.equal(mentions.every((m) => m.deleted === false), true);
  });

  test('does not duplicate rows when append runs again for the same run', async () => {
    await appendTurn('run_mention_1', 2, 'Bandingkan dengan Invoice B');
    const rows = await prisma.chatMessageMention.findMany({
      where: { sessionId, runId: 'run_mention_1' },
    });
    assert.equal(rows.length, 2);
  });

  test('marks a deleted document but keeps its snapshot name', async () => {
    await prisma.document.deleteMany({ where: { id: deletedDocId } });

    const history = await loadUiHistory(sessionId, userId);
    const mentions =
      history.find((m) => m.role === 'user')?.metadata?.mentions ?? [];
    const deleted = mentions.find((m) => m.docId === deletedDocId);
    assert.ok(deleted);
    assert.equal(deleted?.deleted, true);
    assert.equal(deleted?.documentName, 'Deleted.pdf');
  });

  test('clearing the session removes its mention rows', async () => {
    const memory = store([]);
    await memory.clear({ scope: { sessionId, userId } });
    const rows = await prisma.chatMessageMention.findMany({
      where: { sessionId },
    });
    assert.equal(rows.length, 0);
  });
});
