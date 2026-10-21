import { ACCOUNT_QUOTA_BYTES, DOC_ID_RE } from "../../config.js";
import { getDocumentQueue } from "../../config/queue.js";
import {
  ArtifactDiskFullError,
  artifactBytes,
  artifactExists,
  deleteArtifact,
  putArtifact,
  type ArtifactPayload,
} from "../documents/artifacts.js";
import {
  QuotaExceededError,
  assertWithinQuota,
  getOwnerUsage,
  withOwnerStorageLock,
} from "../documents/quota.js";
import { getDocStatus, upsertPendingDoc } from "../documents/store.js";
import { converterClient } from "./client.js";
import {
  isConverterTimeout,
  passThrough,
  type ConvertUpload,
} from "./utils.js";

export type StoreFailure = {
  ok: false;
  status: 413 | 507 | 502;
  detail: string;
};

export type ConversionJob = {
  status?: string;
  doc_id?: string;
  filename?: string | null;
  result?: ArtifactPayload | null;
};

type Stored = { ok: true } | StoreFailure;

/**
 * Ownership context for a conversion. Set for workspace uploads so the
 * artifact meta + Document row carry the owner and workspace; absent for
 * guests (ownerId/workspaceId stay null → expiring doc).
 */
export type PersistContext = {
  ownerId?: string | null;
  workspaceId?: string | null;
};

/**
 * Write the artifact, then record and enqueue indexing.
 * Disk failures surface to the caller. Database and queue failures are logged
 * and do not fail the conversion response.
 */
export async function persistConversion(input: {
  payload: ArtifactPayload;
  filename: string;
  requestId?: string;
  logPrefix: string;
  ctx?: PersistContext;
}): Promise<Stored> {
  const { payload, filename, requestId, logPrefix, ctx } = input;
  if (!payload.doc_id) return { ok: true };
  let sizeBytes = 0;
  try {
    if (!(await artifactExists(payload.doc_id))) {
      await putArtifact({
        ...payload,
        filename,
        owner_id: ctx?.ownerId ?? null,
        workspace_id: ctx?.workspaceId ?? null,
      });
    }
    // Measure after writing: derived files (extracted images/scans) count
    // against the owner quota too (BRD §6.4). Measure even when the artifact
    // already existed, otherwise a retried job could be recorded as 0 bytes.
    sizeBytes = await artifactBytes(payload.doc_id);
  } catch (err) {
    if (err instanceof ArtifactDiskFullError) {
      return {
        ok: false,
        status: 507,
        detail: "Artifact storage is full, try again later.",
      };
    }
    console.error(
      `${logPrefix} store failed req=${requestId ?? "-"} err=${err instanceof Error ? err.message : String(err)}`,
      err instanceof Error ? err.stack : "",
    );
    return { ok: false, status: 502, detail: "Failed to store conversion result." };
  }
  const recorded = await enqueueIndexing(
    payload.doc_id,
    filename,
    payload.markdown_url ?? null,
    payload.stats,
    requestId,
    ctx,
    sizeBytes,
  );
  if (!recorded.ok) {
    // Quota was exceeded after the artifact had already been written: roll it
    // back so the account is not charged for a rejected document.
    try {
      await deleteArtifact(payload.doc_id);
    } catch (err) {
      console.warn(
        `${logPrefix} quota rollback failed doc=${payload.doc_id} err=${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return { ok: false, status: 413, detail: recorded.detail };
  }
  return { ok: true };
}

/** Record a converted doc + enqueue indexing. Idempotent: skips queueing twice. */
export async function enqueueIndexing(
  docId: string,
  name: string,
  markdownUrl: string | null,
  stats: unknown,
  reqId?: string,
  ctx?: PersistContext,
  sizeBytes = 0,
): Promise<{ ok: true } | { ok: false; detail: string }> {
  if (!DOC_ID_RE.test(docId)) {
    console.warn(
      `[index:enqueue] skipped: invalid doc_id=${docId} req=${reqId ?? "-"}`,
    );
    return { ok: true };
  }
  // Async jobs are polled repeatedly — don't enqueue twice.
  try {
    const existing = await getDocStatus(docId);
    if (existing.found) return { ok: true };
  } catch {
    /* status check best-effort; fall through to upsert */
  }
  try {
    const ownerId = ctx?.ownerId ?? null;
    if (ownerId && ACCOUNT_QUOTA_BYTES > 0) {
      const reserved = await withOwnerStorageLock(ownerId, async (tx) => {
        const usage = await getOwnerUsage(ownerId, tx);
        if (usage.usedBytes + sizeBytes > ACCOUNT_QUOTA_BYTES) {
          return { ok: false as const, usedBytes: usage.usedBytes };
        }
        await upsertPendingDoc(
          {
            docId,
            name,
            markdownUrl,
            stats: stats ?? {},
            ownerId,
            workspaceId: ctx?.workspaceId ?? null,
            sizeBytes,
          },
          tx,
        );
        return { ok: true as const };
      });
      if (!reserved.ok) {
        const detail = new QuotaExceededError(reserved.usedBytes).message;
        console.warn(
          `[index:enqueue] doc=${docId} quota exceeded used=${reserved.usedBytes} bytes=${sizeBytes}`,
        );
        return { ok: false, detail };
      }
    } else {
      await upsertPendingDoc({
        docId,
        name,
        markdownUrl,
        stats: stats ?? {},
        ownerId,
        workspaceId: ctx?.workspaceId ?? null,
        sizeBytes,
      });
    }
    console.log(
      `[index:enqueue] doc=${docId} upsert=ok markdownUrl=${markdownUrl ?? "(null)"}`,
    );
    const queue = getDocumentQueue();
    if (!queue) {
      console.error(
        `[index:enqueue] doc=${docId} FAILED queue unavailable (REDIS_URL invalid/unreachable) — worker will never pick this up`,
      );
      return { ok: true };
    }
    try {
      const job = await queue.add("index", { docId, name, markdownUrl });
      console.log(`[index:enqueue] doc=${docId} queued job=${job.id}`);
    } catch (err) {
      console.error(
        `[index:enqueue] doc=${docId} FAILED queue.add err=${err instanceof Error ? err.message : String(err)}`,
        err instanceof Error ? err.stack : "",
      );
    }
  } catch (err) {
    console.warn(
      `[index:enqueue] skipped req=${reqId ?? "-"} err=${err instanceof Error ? err.message : String(err)}`,
      err instanceof Error ? err.stack : "",
    );
  }
  return { ok: true };
}

export type ConvertDocumentResult =
  | { type: "timeout" }
  | { type: "unavailable" }
  | { type: "upstream-failed" }
  | { type: "passthrough"; response: Response }
  | { type: "bad-json" }
  | { type: "quota-exceeded"; detail: string }
  | { type: "store-failed"; status: 413 | 507 | 502; detail: string }
  | { type: "ok"; payload: ArtifactPayload };

export async function convertDocument(
  upload: ConvertUpload,
  requestId?: string,
  ctx?: PersistContext,
  opts: { persist?: boolean } = {},
): Promise<ConvertDocumentResult> {
  const { persist = true } = opts;
  const started = Date.now();
  console.log(
    `[convert] start req=${requestId ?? "-"} file=${upload.file.name} bytes=${upload.file.size}`,
  );
  if (persist && ctx?.ownerId) {
    try {
      // Cheap pre-check: fail before a multi-minute conversion. The exact
      // folder size is re-checked after the artifact is written (persistConversion).
      await assertWithinQuota(ctx.ownerId, upload.file.size);
    } catch (err) {
      if (err instanceof QuotaExceededError) {
        return { type: "quota-exceeded", detail: err.message };
      }
      console.warn(
        `[convert] quota pre-check unavailable req=${requestId ?? "-"} err=${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  let res: Response;
  try {
    res = await converterClient.convertSync(
      upload.upstream,
      undefined,
      requestId,
    );
  } catch (err) {
    const elapsed = Date.now() - started;
    const timedOut = isConverterTimeout(err);
    console.error(
      `converter ${timedOut ? "timeout" : "unreachable"} ` +
        `req=${requestId ?? "-"} file=${upload.file.name} bytes=${upload.file.size} ` +
        `elapsed=${elapsed}ms err=${err instanceof Error ? err.message : String(err)}`,
      err,
    );
    if (timedOut) return { type: "timeout" };
    console.error("converter unreachable", err);
    return { type: "unavailable" };
  }
  console.log(
    `[convert] upstream req=${requestId ?? "-"} status=${res.status} elapsed=${Date.now() - started}ms`,
  );
  if (res.status >= 500) {
    console.error("converter error", res.status);
    return { type: "upstream-failed" };
  }
  if (!res.ok) return { type: "passthrough", response: passThrough(res) };

  let payload: ArtifactPayload;
  try {
    payload = (await res.json()) as ArtifactPayload;
  } catch {
    return { type: "bad-json" };
  }
  if (payload.doc_id && persist) {
    // Attachments pass persist:false (BRD §6.7/§12.13): no artifact, no
    // Document row, no indexing — the converter's doc_id is throwaway.
    const stored = await persistConversion({
      payload,
      filename: upload.file.name,
      requestId,
      logPrefix: "[convert]",
      ctx,
    });
    if (!stored.ok) {
      return {
        type: "store-failed",
        status: stored.status,
        detail: stored.detail,
      };
    }
  }
  return { type: "ok", payload };
}

export type StartConversionResult =
  | { type: "unavailable" }
  | { type: "queue-full" }
  | { type: "upstream-failed" }
  | { type: "quota-exceeded"; detail: string }
  | { type: "passthrough"; response: Response };

export async function startConversion(
  upload: ConvertUpload,
  requestId?: string,
  ctx?: PersistContext,
): Promise<StartConversionResult> {
  console.log(
    `[convert:async] start req=${requestId ?? "-"} file=${upload.file.name} bytes=${upload.file.size}`,
  );
  if (ctx?.ownerId) {
    try {
      await assertWithinQuota(ctx.ownerId, upload.file.size);
    } catch (err) {
      if (err instanceof QuotaExceededError) {
        return { type: "quota-exceeded", detail: err.message };
      }
      console.warn(
        `[convert:async] quota pre-check unavailable req=${requestId ?? "-"} err=${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  let res: Response;
  try {
    res = await converterClient.convertAsync(
      upload.upstream,
      undefined,
      requestId,
    );
  } catch (err) {
    console.error(
      `[convert:async] converter unreachable req=${requestId ?? "-"} err=${err instanceof Error ? err.message : String(err)}`,
      err,
    );
    return { type: "unavailable" };
  }
  if (res.status === 429) return { type: "queue-full" };
  if (res.status >= 500) {
    console.error("[convert:async] converter error", res.status);
    return { type: "upstream-failed" };
  }
  return { type: "passthrough", response: passThrough(res) };
}

export type ConversionJobResult =
  | { type: "unavailable" }
  | { type: "not-found" }
  | { type: "bad-json" }
  | { type: "store-failed"; status: 413 | 507 | 502; detail: string }
  | { type: "ok"; job: ConversionJob };

export async function getConversionJob(
  jobId: string,
  requestId?: string,
  ctx?: PersistContext,
): Promise<ConversionJobResult> {
  let res: Response;
  try {
    res = await converterClient.getJob(jobId);
  } catch {
    return { type: "unavailable" };
  }
  if (res.status === 404) return { type: "not-found" };
  if (!res.ok) return { type: "unavailable" };

  let job: ConversionJob;
  try {
    job = (await res.json()) as ConversionJob;
  } catch {
    return { type: "bad-json" };
  }
  if (job.status === "done" && job.result?.doc_id) {
    const stored = await persistConversion({
      payload: job.result,
      filename: job.filename ?? job.result.doc_id,
      requestId,
      logPrefix: "[convert:async]",
      ctx,
    });
    if (!stored.ok) {
      return {
        type: "store-failed",
        status: stored.status,
        detail: stored.detail,
      };
    }
  }
  return { type: "ok", job };
}

export type CancelConversionResult =
  | { type: "unavailable" }
  | { type: "not-found" }
  | { type: "conflict" }
  | { type: "passthrough"; response: Response };

export async function cancelConversionJob(
  jobId: string,
): Promise<CancelConversionResult> {
  let res: Response;
  try {
    res = await converterClient.cancelJob(jobId);
  } catch {
    return { type: "unavailable" };
  }
  if (res.status === 404) return { type: "not-found" };
  if (res.status === 409) return { type: "conflict" };
  if (!res.ok) return { type: "unavailable" };
  return { type: "passthrough", response: passThrough(res) };
}
