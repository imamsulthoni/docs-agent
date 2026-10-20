import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

process.env.DATABASE_URL ??=
  'postgresql://postgres:postgres@127.0.0.1:15433/postgres';

const { prisma } = await import('../src/utils/prisma.ts');
const service = await import(
  '../src/modules/chat/attachments/service.ts'
);
const intent = await import('../src/modules/chat/attachments/intent.ts');
const { clipAttachments } = await import(
  '../src/modules/chat/attachments/budget.ts'
);
const { buildAnswerPrompt } = await import(
  '../../../packages/agent/src/markdown.ts'
);
const { clearHistory } = await import('../src/modules/chat/service.ts');
const { deleteDocCascade } = await import(
  '../src/modules/documents/store.ts'
);

const {
  createAttachmentRow,
  listSessionAttachments,
  searchSessionAttachments,
  toAttachmentContexts,
} = service;
const { hasAttachmentIntent, matchAttachmentNames } = intent;

function hexDoc(seed: string): string {
  return (seed.repeat(32) + '0'.repeat(32)).slice(0, 32);
}

const suffix = Math.random().toString(36).slice(2, 10);
const ownerA = `u:followupA${suffix}`;
const ownerB = `u:followupB${suffix}`;
const docX = hexDoc('ab');
const docY = hexDoc('cd');
const sessionX = `doc:${docX}:s:followup${suffix}`;
const sessionY = `doc:${docY}:s:followup${suffix}`;

async function seedAttachment(input: {
  ownerId: string;
  docId: string;
  sessionId: string;
  filename: string;
  markdown: string;
  status?: string;
}): Promise<string> {
  const row = await createAttachmentRow({
    ownerId: input.ownerId,
    docId: input.docId,
    sessionId: input.sessionId,
    filename: input.filename,
    mimeType: 'text/plain',
    sizeBytes: input.markdown.length,
  });
  await prisma.chatAttachment.update({
    where: { id: row.id },
    data: { status: input.status ?? 'ready', markdown: input.markdown },
  });
  return row.id;
}

const ids = {
  invoice: '',
  report: '',
  deleted: '',
  foreign: '',
  otherSession: '',
  unlinkedX: '',
  unlinkedY: '',
};

before(async () => {
  await prisma.chatAttachment.deleteMany({
    where: { ownerId: { in: [ownerA, ownerB] } },
  });
  ids.invoice = await seedAttachment({
    ownerId: ownerA,
    docId: docX,
    sessionId: sessionX,
    filename: 'invoice-q1.pdf',
    markdown: 'Invoice Q1 total 1.000.000 jatuh tempo 30 hari.',
  });
  ids.report = await seedAttachment({
    ownerId: ownerA,
    docId: docX,
    sessionId: sessionX,
    filename: 'laporan-q3.txt',
    markdown: 'Laporan penjualan Q3 tumbuh 12 persen.',
  });
  ids.deleted = await seedAttachment({
    ownerId: ownerA,
    docId: docX,
    sessionId: sessionX,
    filename: 'invoice-deleted.pdf',
    markdown: 'Invoice Q1 versi lama.',
    status: 'deleted',
  });
  ids.foreign = await seedAttachment({
    ownerId: ownerB,
    docId: docX,
    sessionId: sessionX,
    filename: 'invoice-foreign.pdf',
    markdown: 'Invoice Q1 milik user lain.',
  });
  ids.otherSession = await seedAttachment({
    ownerId: ownerA,
    docId: docY,
    sessionId: sessionY,
    filename: 'invoice-other.pdf',
    markdown: 'Invoice sesi lain.',
  });
  ids.unlinkedX = await seedAttachment({
    ownerId: ownerA,
    docId: docX,
    sessionId: '',
    filename: 'belum-terkirim.pdf',
    markdown: 'Invoice yang belum terkirim.',
  });
  ids.unlinkedY = await seedAttachment({
    ownerId: ownerA,
    docId: docY,
    sessionId: '',
    filename: 'lain.pdf',
    markdown: 'Dokumen lain.',
  });
});

after(async () => {
  await prisma.chatAttachment.deleteMany({
    where: { ownerId: { in: [ownerA, ownerB] } },
  });
  await prisma.$disconnect();
});

describe('attachment intent', () => {
  test('detects references to earlier uploads', () => {
    for (const question of [
      'ringkas lampiran tadi',
      'apa isi file yang saya upload?',
      'tolong cek pdf tadi',
      'lihat attachment sebelumnya',
    ]) {
      assert.equal(hasAttachmentIntent(question), true, question);
    }
  });

  test('ignores questions without attachment intent', () => {
    for (const question of [
      'ringkas dokumen ini',
      'siapa presiden pertama?',
      'apa isi halaman 3?',
    ]) {
      assert.equal(hasAttachmentIntent(question), false, question);
    }
  });

  test('matches file names with and without extension', () => {
    const rows = [
      { id: '1', filename: 'invoice-q1.pdf' },
      { id: '2', filename: 'laporan_q3.txt' },
    ];
    assert.deepEqual(
      matchAttachmentNames('total di invoice q1 berapa?', rows).map((r) => r.id),
      ['1'],
    );
    assert.deepEqual(
      matchAttachmentNames('lihat laporan q3', rows).map((r) => r.id),
      ['2'],
    );
    assert.equal(matchAttachmentNames('tidak menyebut nama', rows).length, 0);
  });
});

describe('attachment budgets + catalog prompt', () => {
  test('clips per file and total, marking truncated blocks', () => {
    const clipped = clipAttachments(
      [
        { name: 'a.txt', content: 'x'.repeat(10) },
        { name: 'b.txt', content: 'y'.repeat(10) },
      ],
      { perFile: 6, total: 9 },
    );
    assert.equal(clipped.length, 2);
    assert.equal(clipped[0]?.content.length, 6);
    assert.equal(clipped[0]?.truncated, true);
    assert.equal(clipped[1]?.content.length, 3);
    assert.equal(clipped[1]?.truncated, true);
  });

  test('drops blocks once the total budget is exhausted', () => {
    const clipped = clipAttachments(
      [
        { name: 'a.txt', content: 'x'.repeat(10) },
        { name: 'b.txt', content: 'y'.repeat(10) },
      ],
      { perFile: 5, total: 5 },
    );
    assert.equal(clipped.length, 1);
  });

  test('renders the catalog and follow-up instruction', () => {
    const prompt = buildAnswerPrompt(
      'cek lampiran tadi',
      [],
      [],
      [
        { name: 'invoice-q1.pdf' },
        { name: 'laporan-q3.txt', truncated: true },
      ],
    );
    assert.match(prompt, /<attachments available="true">/);
    assert.match(prompt, /<file name="invoice-q1\.pdf" \/>/);
    assert.match(
      prompt,
      /<file name="laporan-q3\.txt" truncated="true" \/>/,
    );
    assert.match(prompt, /tool attachmentSearch/);
  });

  test('omits the catalog block without earlier attachments', () => {
    const prompt = buildAnswerPrompt('halo', []);
    assert.doesNotMatch(prompt, /<attachments available/);
    assert.doesNotMatch(prompt, /tool attachmentSearch/);
  });

  test('escapes quotes in file names inside prompt attributes', () => {
    const prompt = buildAnswerPrompt('cek file', [], [], [
      { name: 'evil" onload="x.pdf' },
    ]);
    assert.match(prompt, /name="evil&quot; onload=&quot;x\.pdf"/);
    assert.doesNotMatch(prompt, /name="evil" onload="x\.pdf"/);
  });
});

describe('session attachment lookup', () => {
  test('lists only own ready rows in the session', async () => {
    const rows = await listSessionAttachments(ownerA, sessionX);
    const filenames = rows.map((r) => r.filename).sort();
    assert.deepEqual(filenames, ['invoice-q1.pdf', 'laporan-q3.txt']);
  });

  test('keyword search is scoped and returns snippets', async () => {
    const hits = await searchSessionAttachments(
      ownerA,
      sessionX,
      'invoice total',
    );
    assert.equal(hits.length, 1);
    assert.equal(hits[0]?.filename, 'invoice-q1.pdf');
    assert.match(hits[0]?.snippet ?? '', /Invoice Q1 total/);
    assert.doesNotMatch(hits[0]?.snippet ?? '', /user lain/);
  });

  test('keyword search ignores other sessions and deleted rows', async () => {
    const hits = await searchSessionAttachments(ownerA, sessionX, 'versi lama');
    assert.equal(hits.length, 0);
    const other = await searchSessionAttachments(ownerA, sessionY, 'invoice');
    assert.deepEqual(other.map((h) => h.filename), ['invoice-other.pdf']);
  });

  test('builds follow-up contexts with injection flags', async () => {
    const loaded = await service.loadAttachmentContents(ownerA, sessionX, [
      ids.invoice,
    ]);
    const contexts = toAttachmentContexts(loaded, {
      perFile: 12,
      total: 30,
    });
    assert.equal(contexts.length, 1);
    assert.equal(contexts[0]?.name, 'invoice-q1.pdf');
    assert.equal(contexts[0]?.content.length, 12);
    assert.equal(contexts[0]?.truncated, true);
  });
});

describe('attachment cascade cleanup', () => {
  test('clearing a session deletes its attachments and keeps others', async () => {
    await clearHistory(sessionX, ownerA);
    const remaining = await prisma.chatAttachment.findMany({
      where: { sessionId: sessionX },
      select: { id: true, ownerId: true },
    });
    assert.equal(
      remaining.some((row) => row.id === ids.invoice),
      false,
    );
    assert.equal(
      remaining.some((row) => row.id === ids.report),
      false,
    );
    // Another owner sharing the same session id is never touched.
    assert.equal(
      remaining.some((row) => row.id === ids.foreign),
      true,
    );
    const otherSession = await prisma.chatAttachment.findUnique({
      where: { id: ids.otherSession },
    });
    assert.ok(otherSession);
  });

  test('document deletion also drops unlinked attachments for that doc', async () => {
    await deleteDocCascade(docX);
    const gone = await prisma.chatAttachment.findUnique({
      where: { id: ids.unlinkedX },
    });
    assert.equal(gone, null);
    const kept = await prisma.chatAttachment.findUnique({
      where: { id: ids.unlinkedY },
    });
    assert.ok(kept);
  });
});
