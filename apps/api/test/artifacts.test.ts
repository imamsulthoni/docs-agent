import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';

const docId = 'a'.repeat(32);
const root = await mkdtemp(path.join(os.tmpdir(), 'docsagent-artifacts-'));
process.env.ARTIFACT_DIR = root;
process.env.ARTIFACT_MAX_MB = '1';
process.env.DATABASE_URL ??=
  'postgresql://postgres:postgres@127.0.0.1:15433/postgres';

const artifacts = await import('../src/modules/documents/artifacts.ts');

describe('artifact store', () => {
  before(async () => {
    await rm(root, { recursive: true, force: true });
  });

  after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  test('writes markdown and image bytes under /public paths', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    await artifacts.putArtifact({
      doc_id: docId,
      filename: 'sample.pdf',
      markdown: `## Page 1\n\n![Gambar](/public/${docId}/images/page-001-image-001.png)\n`,
      markdown_url: `/public/${docId}/doc.md`,
      expires_at: '2099-01-01T00:00:00.000Z',
      stats: { pages: 1 },
      warnings: [],
      images: [
        {
          url: `/public/${docId}/images/page-001-image-001.png`,
          filename: 'page-001-image-001.png',
          data_base64: png.toString('base64'),
        },
      ],
    });

    assert.equal(await artifacts.readMarkdown(docId), expectMarkdown(docId));
    const image = await artifacts.readPublicFile(`${docId}/images/page-001-image-001.png`);
    assert.ok(image);
    assert.equal(image.contentType, 'image/png');
    assert.deepEqual(image.body, png);

    const listed = await artifacts.listArtifacts();
    assert.equal(listed.length, 1);
    assert.equal(listed[0]?.doc_id, docId);
    assert.equal(listed[0]?.filename, 'sample.pdf');
    assert.deepEqual(await artifacts.listExpiredDocIds(new Date('2000-01-01T00:00:00.000Z')), []);
    assert.deepEqual(await artifacts.listExpiredDocIds(new Date('2100-01-01T00:00:00.000Z')), [docId]);
  });

  test('rejects traversal and a foreign doc url', async () => {
    assert.equal(await artifacts.readPublicFile('../secrets.txt'), null);
    assert.equal(await artifacts.readMarkdown('not-an-id'), null);
    await assert.rejects(
      () => artifacts.putArtifact({ doc_id: 'nope', markdown: 'x' }),
      artifacts.ArtifactError,
    );
  });

  test('strips image bytes from the client payload', () => {
    const stripped = artifacts.stripImageBytes({
      images: [{ url: '/public/x', data_base64: 'abc' }],
      result: { images: [{ url: '/public/y', data_base64: 'def', page: 1 }] },
    });
    assert.equal('data_base64' in (stripped.images[0] ?? {}), false);
    assert.equal(stripped.result.images[0]?.page, 1);
    assert.equal('data_base64' in (stripped.result.images[0] ?? {}), false);
  });

  test('deletes the doc directory', async () => {
    assert.equal(await artifacts.deleteArtifact(docId), true);
    assert.equal(await artifacts.readMarkdown(docId), null);
    assert.deepEqual(await artifacts.listArtifacts(), []);
  });

  test('never expires a persistent doc and records its owner', async () => {
    const persistentId = 'c'.repeat(32);
    const guestId = 'd'.repeat(32);
    const past = '2000-01-01T00:00:00.000Z';

    // Both carry a converter expiry in the past, but only the guest should expire.
    await artifacts.putArtifact({
      doc_id: persistentId,
      markdown: '## Page 1\n',
      expires_at: past,
      owner_id: 'u:owner-1',
      workspace_id: 'ws_1',
    });
    await artifacts.putArtifact({
      doc_id: guestId,
      markdown: '## Page 1\n',
      expires_at: past,
    });

    const expired = await artifacts.listExpiredDocIds(
      new Date('2100-01-01T00:00:00.000Z'),
    );
    assert.deepEqual(expired, [guestId]);

    const listed = await artifacts.listArtifacts();
    const persistent = listed.find((d) => d.doc_id === persistentId);
    assert.equal(persistent?.expires_at, null);
    assert.equal(persistent?.workspace_id, 'ws_1');
    assert.equal(persistent?.owner_id, 'u:owner-1');

    // The guest listing must not leak owner/workspace docs.
    const guests = await artifacts.listGuestArtifacts();
    assert.deepEqual(
      guests.map((d) => d.doc_id),
      [guestId],
    );
  });

  test('reports disk full once usage reaches the cap', async () => {
    await writeFile(path.join(root, 'blob.bin'), Buffer.alloc(1024 * 1024));
    assert.equal(await artifacts.isArtifactDiskFull(), true);
    await assert.rejects(
      () =>
        artifacts.putArtifact({
          doc_id: 'b'.repeat(32),
          markdown: '## Page 1\n',
        }),
      artifacts.ArtifactDiskFullError,
    );
  });
});

function expectMarkdown(id: string): string {
  return `## Page 1\n\n![Gambar](/public/${id}/images/page-001-image-001.png)\n`;
}
