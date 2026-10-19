import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ARTIFACT_DIR, ARTIFACT_MAX_BYTES, DOC_ID_RE } from '../../config.js';

const MARKDOWN_FILENAME = 'doc.md';

const CONTENT_TYPES: Record<string, string> = {
  '.md': 'text/markdown; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.jp2': 'image/jp2',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
};

export class ArtifactError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ArtifactError';
  }
}

export class ArtifactDiskFullError extends Error {
  constructor() {
    super('Artifact storage is full.');
    this.name = 'ArtifactDiskFullError';
  }
}

export type ArtifactImage = {
  url?: string;
  filename?: string;
  kind?: string;
  data_base64?: string | null;
  /** Standalone image OCR (`/v1/ocr`): recognized text for this image. */
  ocr_text?: string;
  flowchart_mermaid?: string;
};

export type ArtifactPayload = {
  doc_id: string;
  markdown: string;
  markdown_url?: string | null;
  filename?: string;
  stats?: unknown;
  warnings?: unknown;
  expires_at?: string | null;
  owner_id?: string | null;
  workspace_id?: string | null;
  images?: ArtifactImage[];
};

export type ArtifactMeta = {
  doc_id: string;
  markdown_url: string;
  filename?: string;
  created_at?: string;
  expires_at?: string | null;
  owner_id?: string | null;
  workspace_id?: string | null;
  stats?: unknown;
  warnings?: unknown;
};

/**
 * Persistent (login-owned) documents live in a workspace and never expire.
 * Guests keep `workspace_id: null` and stay bound to `expires_at`.
 * `meta.json` is the sweep's source of truth, so this invariant is enforced
 * on write and re-checked on read (see `listExpiredDocIds`).
 */
export function isPersistentDoc(doc: {
  workspace_id?: string | null;
}): boolean {
  return Boolean(doc.workspace_id);
}

export type StoredFile = {
  body: Buffer;
  contentType: string;
};

function assertDocId(docId: string): void {
  if (!DOC_ID_RE.test(docId)) throw new ArtifactError('Invalid doc_id.');
}

function imageRelativePath(docId: string, image: ArtifactImage): string | null {
  const match = /^\/public\/([0-9a-f]{32})\/(images|scans)\/([^/]+)$/.exec(image.url ?? '');
  if (!match || match[1] !== docId) return null;
  const filename = match[3];
  if (!filename || filename === '.' || filename === '..' || filename.includes('\\')) return null;
  return path.join(match[2], filename);
}

async function directoryBytes(root: string): Promise<number> {
  let names: string[];
  try {
    names = await readdir(root);
  } catch {
    return 0;
  }
  let total = 0;
  for (const name of names) {
    const full = path.join(root, name);
    const info = await stat(full);
    total += info.isDirectory() ? await directoryBytes(full) : info.size;
  }
  return total;
}

export async function isArtifactDiskFull(): Promise<boolean> {
  if (ARTIFACT_MAX_BYTES <= 0) return false;
  const used = await directoryBytes(ARTIFACT_DIR);
  return used >= ARTIFACT_MAX_BYTES;
}

export async function artifactExists(docId: string): Promise<boolean> {
  if (!DOC_ID_RE.test(docId)) return false;
  try {
    await stat(path.join(ARTIFACT_DIR, docId, MARKDOWN_FILENAME));
    return true;
  } catch {
    return false;
  }
}

export async function putArtifact(doc: ArtifactPayload): Promise<void> {
  assertDocId(doc.doc_id);
  if (typeof doc.markdown !== 'string') throw new ArtifactError('Missing markdown.');
  if (await isArtifactDiskFull()) throw new ArtifactDiskFullError();

  const base = path.join(ARTIFACT_DIR, doc.doc_id);
  await mkdir(path.join(base, 'images'), { recursive: true });
  await mkdir(path.join(base, 'scans'), { recursive: true });
  await writeFile(path.join(base, MARKDOWN_FILENAME), doc.markdown, 'utf8');

  const persistent = isPersistentDoc(doc);
  const meta: ArtifactMeta = {
    doc_id: doc.doc_id,
    filename: doc.filename ?? doc.doc_id,
    markdown_url: doc.markdown_url ?? `/public/${doc.doc_id}/${MARKDOWN_FILENAME}`,
    stats: doc.stats ?? {},
    warnings: Array.isArray(doc.warnings) ? doc.warnings : [],
    created_at: new Date().toISOString(),
    // Persistent docs never carry an expiry, even if the converter returned one.
    expires_at: persistent ? null : (doc.expires_at ?? null),
    owner_id: doc.owner_id ?? null,
    workspace_id: doc.workspace_id ?? null,
  };
  await writeFile(path.join(base, 'meta.json'), JSON.stringify(meta), 'utf8');

  for (const image of doc.images ?? []) {
    if (!image.data_base64) continue;
    const relative = imageRelativePath(doc.doc_id, image);
    if (!relative) continue;
    await writeFile(path.join(base, relative), Buffer.from(image.data_base64, 'base64'));
  }
}

export function contentTypeFor(filename: string): string {
  return CONTENT_TYPES[path.extname(filename).toLowerCase()] ?? 'application/octet-stream';
}

export async function readPublicFile(relativePath: string): Promise<StoredFile | null> {
  if (!relativePath || relativePath.includes('..') || path.isAbsolute(relativePath)) return null;
  const root = path.resolve(ARTIFACT_DIR);
  const full = path.resolve(root, relativePath);
  if (full !== root && !full.startsWith(`${root}${path.sep}`)) return null;
  try {
    const body = await readFile(full);
    return { body, contentType: contentTypeFor(full) };
  } catch {
    return null;
  }
}

export async function readMarkdown(docId: string): Promise<string | null> {
  if (!DOC_ID_RE.test(docId)) return null;
  const file = await readPublicFile(`${docId}/${MARKDOWN_FILENAME}`);
  return file ? file.body.toString('utf8') : null;
}

/** Read one doc's meta.json (ownership + expiry) without listing the whole dir. */
export async function readArtifactMeta(docId: string): Promise<ArtifactMeta | null> {
  if (!DOC_ID_RE.test(docId)) return null;
  try {
    const raw = await readFile(path.join(ARTIFACT_DIR, docId, 'meta.json'), 'utf8');
    const meta = JSON.parse(raw) as ArtifactMeta;
    return { ...meta, doc_id: docId };
  } catch {
    return null;
  }
}

export async function listArtifacts(): Promise<ArtifactMeta[]> {
  let names: string[];
  try {
    names = await readdir(ARTIFACT_DIR);
  } catch {
    return [];
  }
  const documents: ArtifactMeta[] = [];
  for (const name of names) {
    if (!DOC_ID_RE.test(name)) continue;
    const markdownPath = path.join(ARTIFACT_DIR, name, MARKDOWN_FILENAME);
    try {
      await stat(markdownPath);
    } catch {
      continue;
    }
    const item: ArtifactMeta = {
      doc_id: name,
      markdown_url: `/public/${name}/${MARKDOWN_FILENAME}`,
    };
    try {
      const raw = JSON.parse(
        await readFile(path.join(ARTIFACT_DIR, name, 'meta.json'), 'utf8'),
      ) as ArtifactMeta;
      documents.push({ ...item, ...raw, doc_id: name });
    } catch {
      const info = await stat(markdownPath);
      documents.push({ ...item, created_at: info.mtime.toISOString() });
    }
  }
  documents.sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''));
  return documents;
}

/**
 * Docs the anonymous landing page may show: no owner and no workspace.
 * Workspace-owned docs are private to their owner and must never leak into
 * the guest listing, even though they share the same artifact directory.
 */
export async function listGuestArtifacts(): Promise<ArtifactMeta[]> {
  const documents = await listArtifacts();
  return documents.filter((doc) => !doc.owner_id && !doc.workspace_id);
}

export async function listExpiredDocIds(now: Date = new Date()): Promise<string[]> {
  const documents = await listArtifacts();
  return documents
    .filter((doc) => {
      // Persistent (workspace-owned) docs are never swept, regardless of
      // expires_at — defense-in-depth over the write-time invariant.
      if (isPersistentDoc(doc)) return false;
      if (!doc.expires_at) return false;
      const expires = new Date(doc.expires_at).getTime();
      return Number.isFinite(expires) && expires <= now.getTime();
    })
    .map((doc) => doc.doc_id);
}

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** Drop one-time image bytes before the payload is sent to the browser. */
export function stripImageBytes<T>(value: T): T {
  if (!isRecord(value)) return value;
  const record: JsonRecord = value;
  const images = record.images;
  if (Array.isArray(images)) {
    record.images = images.map((image) => {
      if (!isRecord(image)) return image;
      const copy = { ...image };
      delete copy.data_base64;
      return copy;
    });
  }
  if (isRecord(record.result)) stripImageBytes(record.result);
  return value;
}

export async function deleteArtifact(docId: string): Promise<boolean> {
  if (!DOC_ID_RE.test(docId)) return false;
  await rm(path.join(ARTIFACT_DIR, docId), { recursive: true, force: true });
  return true;
}
