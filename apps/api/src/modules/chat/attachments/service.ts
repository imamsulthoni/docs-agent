import {
  ATTACH_MAX_CHARS,
  ATTACH_SEARCH_CANDIDATES,
  ATTACH_SEARCH_MAX_ROWS,
  ATTACH_SEARCH_SNIPPET_CHARS,
  ATTACH_SEARCH_TOP_K,
  ATTACH_STALE_MS,
} from "../../../config.js";
import { containsInjectionPattern, type AttachmentContext } from "@docs-agent/agent";
import { prisma } from "../../../utils/prisma.js";
import { convertDocument } from "../../converter/service.js";
import { converterClient } from "../../converter/client.js";
import type { ArtifactPayload } from "../../documents/artifacts.js";
import { isConverterTimeout } from "../../converter/utils.js";
import { sanitizeFilename, truncateAttachmentContent, type AttachmentKind } from "./magic.js";
import { clipAttachments, type ClipBudget } from "./budget.js";
import { searchTokens } from "./intent.js";

export type AttachmentStatus = "processing" | "ready" | "failed" | "deleted";

export function toAttachmentResult(row: {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  status: string;
  truncated: boolean;
  error: string | null;
  createdAt: Date;
}): {
  id: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  status: string;
  truncated: boolean;
  error: string | null;
  created_at: string;
} {
  return {
    id: row.id,
    filename: row.filename,
    mime_type: row.mimeType,
    size_bytes: row.sizeBytes,
    status: row.status,
    truncated: row.truncated,
    error: row.error,
    created_at: row.createdAt.toISOString(),
  };
}

/** Client-safe chip for rendered history messages. */
export interface UiAttachment {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  truncated: boolean;
  deleted: boolean;
}

export type CreateAttachmentError =
  | { ok: false; status: 413; detail: string }
  | { ok: false; status: 422; detail: string };

/**
 * String-id of the logged-in identity (`u:<id>`); attachment ownership is
 * scoped to that identity, so the resolve path can never leak other users.
 */
export async function countOpenAttachments(
  ownerId: string,
  sessionId: string,
): Promise<number> {
  return prisma.chatAttachment.count({
    where: { ownerId, sessionId, status: { not: "deleted" } },
  });
}

export async function markAttachmentFailed(
  id: string,
  error: string,
): Promise<void> {
  // `status != deleted` keeps a user soft-delete from being resurrected by a
  // still-running background job.
  await prisma.chatAttachment.updateMany({
    where: { id, status: { not: "deleted" } },
    data: { status: "failed", markdown: null, error },
  });
}

/** Convert markdown, minus embedded file-image references (extraction is off). */
function pdfTextFromPayload(payload: ArtifactPayload): string {
  return (payload.markdown ?? "").trim();
}

/**
 * OCR images carry text in `images[].ocr_text`; the payload markdown's
 * `![…](/public/…)` links point at the converter's own throwaway artifacts
 * (not served by this gateway), so they are stripped.
 */
function ocrTextFromPayload(payload: ArtifactPayload): string {
  const parts: string[] = [];
  for (const image of payload.images ?? []) {
    const text = typeof image?.ocr_text === "string" ? image.ocr_text.trim() : "";
    if (text) parts.push(text);
  }
  const markdown = (payload.markdown ?? "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .trim();
  return [parts.join("\n\n"), markdown].filter(Boolean).join("\n\n");
}

async function processPdfAttachment(
  buffer: Buffer,
  filename: string,
  requestId?: string,
): Promise<string> {
  const file = new File([new Uint8Array(buffer)], filename, {
    type: "application/pdf",
  });
  const upstream = new FormData();
  upstream.append("file", file, filename);
  // Attachments need text only: image extraction off, page OCR on.
  upstream.append("scan_images", "false");
  upstream.append("extract_images", "false");
  upstream.append("ocr_images", "true");
  upstream.append("ocr_scope", "all");
  const result = await convertDocument(
    { ok: true, file, upstream },
    requestId,
    undefined,
    // BRD §12.13: attachments must never become Documents/artifacts.
    { persist: false },
  );
  switch (result.type) {
    case "ok": {
      const text = pdfTextFromPayload(result.payload);
      if (!text) throw new Error("PDF tidak memiliki teks yang bisa diekstrak.");
      return text;
    }
    case "timeout":
      throw new Error("Konversi PDF ke teks melebihi batas waktu.");
    case "unavailable":
      throw new Error("Layanan konversi tidak tersedia, coba lagi nanti.");
    case "upstream-failed":
      throw new Error("Konversi PDF gagal di layanan konversi.");
    case "passthrough":
      throw new Error(`Konversi PDF ditolak (HTTP ${result.response.status}).`);
    case "bad-json":
    case "store-failed":
    default:
      throw new Error("Konversi PDF menghasilkan data yang tidak valid.");
  }
}

async function processImageAttachment(
  buffer: Buffer,
  mime: string,
  filename: string,
  requestId?: string,
): Promise<string> {
  const form = new FormData();
  form.append(
    "file",
    new Blob([new Uint8Array(buffer)], { type: mime }),
    filename,
  );
  let response: Response;
  try {
    response = await converterClient.ocrImage(form, undefined, requestId);
  } catch (err) {
    if (isConverterTimeout(err)) {
      throw new Error("OCR gambar melebihi batas waktu.");
    }
    throw new Error("Layanan OCR tidak tersedia, coba lagi nanti.");
  }
  if (!response.ok) {
    const detail =
      response.status === 413
        ? "Gambar melebihi batas OCR upstream."
        : `OCR gambar gagal (HTTP ${response.status}).`;
    throw new Error(detail);
  }
  let payload: ArtifactPayload;
  try {
    payload = (await response.json()) as ArtifactPayload;
  } catch {
    throw new Error("Layanan OCR mengirim respons yang tidak valid.");
  }
  const text = ocrTextFromPayload(payload);
  if (!text.trim()) {
    throw new Error("OCR tidak menemukan teks pada gambar.");
  }
  return text;
}

async function processTextAttachment(buffer: Buffer): Promise<string> {
  const text = buffer.toString("utf8");
  if (!text.trim()) throw new Error("File teks kosong.");
  return text;
}

export type ProcessAttachmentInput = {
  id: string;
  kind: AttachmentKind;
  mime: string;
  buffer: Buffer;
  filename: string;
  requestId?: string;
};

/**
 * Run processing and persist the result. Background jobs call this via
 * `startAttachmentProcessing`; tests/direct callers get full control.
 */
export async function processAttachment(
  input: ProcessAttachmentInput,
): Promise<void> {
  const { id, kind, mime, buffer, filename, requestId } = input;
  try {
    const raw =
      kind === "pdf"
        ? await processPdfAttachment(buffer, filename, requestId)
        : kind === "image"
          ? await processImageAttachment(buffer, mime, filename, requestId)
          : await processTextAttachment(buffer);
    const { content, truncated } = truncateAttachmentContent(
      raw,
      ATTACH_MAX_CHARS,
    );
    await prisma.chatAttachment.updateMany({
      // Only rows still being processed accept a result: neither a user
      // soft-delete nor a previous failure is resurrected by this write.
      where: { id, status: "processing" },
      data: {
        status: "ready",
        markdown: content,
        truncated,
        mimeType: mime,
        error: null,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Pemrosesan gagal.";
    console.error(
      `[chat:attachment] id=${id} FAILED kind=${kind} err=${message}`,
    );
    try {
      await markAttachmentFailed(id, message);
    } catch (updateErr) {
      console.error(
        `[chat:attachment] id=${id} failed-status write FAILED`,
        updateErr,
      );
    }
  }
}

/** Fire-and-forget wrapper for the POST route; POST already stored the row. */
export function startAttachmentProcessing(input: ProcessAttachmentInput): void {
  void processAttachment(input);
}

export type ReadyAttachment = AttachmentContext & { id: string };

export type ResolvedAttachments =
  | { ok: true; attachments: ReadyAttachment[] }
  | { ok: false; status: 403; detail: string };

/**
 * Resolve attachment ids sent with a message into ready prompt contexts.
 * Ownership + session scoping are enforced silently (a mismatch rejects the
 * whole message with a generic 403, like foreign mentions). Rows with an
 * empty sessionId (uploaded without one) are attached to the sending session.
 */
export async function resolveReadyAttachments(
  ownerId: string,
  sessionId: string,
  attachmentIds: string[],
): Promise<ResolvedAttachments> {
  if (attachmentIds.length === 0) return { ok: true, attachments: [] };
  const rows = await prisma.chatAttachment.findMany({
    where: {
      id: { in: attachmentIds },
      ownerId,
      sessionId: { in: ["", sessionId] },
      status: "ready",
    },
    select: { id: true, filename: true, markdown: true, truncated: true },
  });
  if (rows.length !== attachmentIds.length) {
    return {
      ok: false,
      status: 403,
      detail: "One or more attachments are not available.",
    };
  }
  return {
    ok: true,
    attachments: rows.map((row) => ({
      id: row.id,
      name: sanitizeFilename(row.filename),
      content: row.markdown ?? "",
      ...(row.truncated ? { truncated: true } : {}),
      // BRD §6.7: OCR/PDF text is data — flag injection-style content so the
      // prompt marks the block as untrusted rather than blocking it.
      ...(row.markdown && containsInjectionPattern(row.markdown)
        ? { flagged: true }
        : {}),
    })),
  };
}

/** Record which sent message used these attachments (history chips). */
export async function linkAttachmentsToRun(
  ownerId: string,
  sessionId: string,
  attachmentIds: string[],
  runId: string,
): Promise<void> {
  if (attachmentIds.length === 0) return;
  try {
    await prisma.chatAttachment.updateMany({
      where: {
        id: { in: attachmentIds },
        ownerId,
        sessionId: { in: ["", sessionId] },
        status: "ready",
      },
      data: { messageRef: runId, sessionId },
    });
  } catch (err) {
    console.warn("[chat:attachment] link failed", err);
  }
}

/** Attachment chips keyed by the run that used them. */
export async function loadAttachmentChips(
  sessionId: string,
): Promise<Map<string, UiAttachment[]>> {
  const rows = await prisma.chatAttachment.findMany({
    where: { sessionId, messageRef: { not: null } },
    orderBy: { createdAt: "asc" },
    select: {
      messageRef: true,
      id: true,
      filename: true,
      mimeType: true,
      sizeBytes: true,
      truncated: true,
      status: true,
    },
  });
  const byRun = new Map<string, UiAttachment[]>();
  for (const row of rows) {
    if (!row.messageRef) continue;
    const messages = byRun.get(row.messageRef) ?? [];
    messages.push({
      id: row.id,
      filename: row.filename,
      mimeType: row.mimeType,
      sizeBytes: row.sizeBytes,
      truncated: row.truncated,
      deleted: row.status === "deleted",
    });
    byRun.set(row.messageRef, messages);
  }
  return byRun;
}

export type SessionAttachmentRow = {
  id: string;
  filename: string;
  truncated: boolean;
  createdAt: Date;
};

/** Ready attachments of one chat session (metadata only, no markdown). */
export async function listSessionAttachments(
  ownerId: string,
  sessionId: string,
): Promise<SessionAttachmentRow[]> {
  return prisma.chatAttachment.findMany({
    where: {
      ownerId,
      sessionId,
      status: "ready",
      markdown: { not: null },
    },
    orderBy: { createdAt: "desc" },
    take: ATTACH_SEARCH_MAX_ROWS,
    select: {
      id: true,
      filename: true,
      truncated: true,
      createdAt: true,
    },
  });
}

export type LoadedAttachment = {
  id: string;
  filename: string;
  markdown: string | null;
  truncated: boolean;
};

/** Full text for a bounded set of the session's ready attachments. */
export async function loadAttachmentContents(
  ownerId: string,
  sessionId: string,
  ids: readonly string[],
): Promise<LoadedAttachment[]> {
  if (ids.length === 0) return [];
  return prisma.chatAttachment.findMany({
    where: { id: { in: [...ids] }, ownerId, sessionId, status: "ready" },
    orderBy: { createdAt: "asc" },
    take: ATTACH_SEARCH_CANDIDATES,
    select: { id: true, filename: true, markdown: true, truncated: true },
  });
}

export type AttachmentSearchHit = {
  id: string;
  filename: string;
  snippet: string;
  score: number;
};

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let at = haystack.indexOf(needle);
  while (at >= 0) {
    count += 1;
    at = haystack.indexOf(needle, at + needle.length);
  }
  return count;
}

function snippetAround(
  content: string,
  tokens: readonly string[],
  maxChars: number,
): string {
  const lower = content.toLowerCase();
  let at = -1;
  for (const token of tokens) {
    const index = lower.indexOf(token);
    if (index >= 0 && (at < 0 || index < at)) at = index;
  }
  const start = Math.max(0, at - Math.floor(maxChars / 3));
  const end = Math.min(content.length, start + maxChars);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < content.length ? "…" : "";
  return `${prefix}${content.slice(start, end).trim()}${suffix}`;
}

/**
 * Keyword search over one session's ready attachments. Postgres only pre-filters
 * candidates (bounded by ATTACH_SEARCH_CANDIDATES) — scoring and snippets stay
 * in-process so results are deterministic and cheap for the chat path.
 */
export async function searchSessionAttachments(
  ownerId: string,
  sessionId: string,
  query: string,
): Promise<AttachmentSearchHit[]> {
  const tokens = searchTokens(query);
  if (tokens.length === 0) return [];
  const rows = await prisma.chatAttachment.findMany({
    where: {
      ownerId,
      sessionId,
      status: "ready",
      markdown: { not: null },
      OR: tokens.map((token) => ({
        markdown: { contains: token, mode: "insensitive" },
      })),
    },
    orderBy: { createdAt: "desc" },
    take: ATTACH_SEARCH_CANDIDATES,
    select: { id: true, filename: true, markdown: true },
  });

  return rows
    .map((row) => {
      const content = row.markdown ?? "";
      const lower = content.toLowerCase();
      const score = tokens.reduce(
        (sum, token) => sum + countOccurrences(lower, token),
        0,
      );
      return {
        id: row.id,
        filename: sanitizeFilename(row.filename),
        snippet: snippetAround(content, tokens, ATTACH_SEARCH_SNIPPET_CHARS),
        score,
      };
    })
    .filter((hit) => hit.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, ATTACH_SEARCH_TOP_K);
}

/** Prompt contexts for earlier-turn attachments, with clipping/injection flags. */
export function toAttachmentContexts(
  rows: ReadonlyArray<{
    filename: string;
    markdown: string | null;
    truncated: boolean;
  }>,
  budget: ClipBudget,
): AttachmentContext[] {
  return clipAttachments(
    rows.map((row) => {
      const content = row.markdown ?? "";
      return {
        name: sanitizeFilename(row.filename),
        content,
        ...(row.truncated ? { truncated: true } : {}),
        ...(containsInjectionPattern(content) ? { flagged: true } : {}),
      };
    }),
    budget,
  );
}

export type CreateAttachmentInput = {
  ownerId: string;
  docId: string;
  sessionId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
};

export type NewAttachmentRow = {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  status: string;
  truncated: boolean;
  error: string | null;
  createdAt: Date;
};

/** Insert the processing row; POST replies 202 with its id before work starts. */
export async function createAttachmentRow(
  input: CreateAttachmentInput,
): Promise<NewAttachmentRow> {
  const row = await prisma.chatAttachment.create({
    data: {
      ownerId: input.ownerId,
      docId: input.docId,
      sessionId: input.sessionId,
      filename: input.filename,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      status: "processing",
    },
  });
  return {
    id: row.id,
    filename: row.filename,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    status: row.status,
    truncated: row.truncated,
    error: row.error,
    createdAt: row.createdAt,
  };
}

/** Reap rows wedged in `processing` (API restart mid-job) on the next poll. */
async function reapStaleProcessing(row: {
  id: string;
  status: string;
  createdAt: Date;
}): Promise<void> {
  if (
    row.status !== "processing" ||
    Date.now() - row.createdAt.getTime() <= ATTACH_STALE_MS
  ) {
    return;
  }
  await markAttachmentFailed(row.id, "Pemrosesan lampiran melebihi batas waktu.");
}

export async function getAttachment(
  ownerId: string,
  attachmentId: string,
): Promise<{
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  status: string;
  truncated: boolean;
  error: string | null;
  createdAt: Date;
} | null> {
  const row = await prisma.chatAttachment.findFirst({
    where: { id: attachmentId, ownerId },
    select: {
      id: true,
      filename: true,
      mimeType: true,
      sizeBytes: true,
      status: true,
      truncated: true,
      error: true,
      createdAt: true,
    },
  });
  if (!row) return null;
  try {
    await reapStaleProcessing(row);
  } catch (err) {
    console.warn("[chat:attachment] stale reap failed", err);
  }
  return row;
}

/** Soft delete (BRD: chips stay renderable in history, like mention names). */
export async function deleteAttachment(
  ownerId: string,
  attachmentId: string,
): Promise<{ id: string; status: string } | null> {
  const row = await prisma.chatAttachment.findFirst({
    where: { id: attachmentId, ownerId },
    select: { id: true, status: true },
  });
  if (!row) return null;
  if (row.status !== "deleted") {
    await prisma.chatAttachment.update({
      where: { id: row.id },
      data: { status: "deleted", markdown: null },
    });
  }
  return { id: row.id, status: "deleted" };
}
