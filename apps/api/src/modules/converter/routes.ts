import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { DOC_ID_RE, MAX_UPLOAD_BYTES, sessionUserId } from "../../config.js";
import { stripImageBytes } from "../documents/artifacts.js";
import { loadSession, type AuthVariables } from "../auth/middleware.js";
import {
  cancelConversionJob,
  convertDocument,
  getConversionJob,
  startConversion,
  type PersistContext,
} from "./service.js";
import { parseConvertForm } from "./utils.js";

type Ctx = Context<{ Variables: AuthVariables }>;

const converterRoutes = new Hono<{ Variables: AuthVariables }>();

converterRoutes.use("/*", loadSession);

converterRoutes.use(
  "/convert*",
  bodyLimit({ maxSize: MAX_UPLOAD_BYTES + 1024 * 1024 }),
);

/** Owner identity from the session (never from the client). */
function ownerFromSession(c: Ctx): string | null {
  const user = c.get("user");
  return user ? sessionUserId(user.id) : null;
}

/** Sync conversion: returns result directly. `ctx` carries workspace ownership. */
export async function runSyncConvert(
  c: Ctx,
  ctx: PersistContext,
): Promise<Response> {
  const requestId = c.get("requestId") as string | undefined;
  let form: FormData;
  try {
    form = await c.req.formData();
  } catch {
    return c.json({ detail: "Invalid multipart body." }, 400);
  }
  const upload = parseConvertForm(form);
  if (!upload.ok) return c.json({ detail: upload.detail }, upload.status);

  const result = await convertDocument(upload, requestId, ctx);
  if (result.type === "timeout") {
    return c.json(
      {
        detail:
          "Conversion timed out. The file is likely large — retry with async mode or turn off image OCR.",
        code: "convert_timeout",
      },
      504,
    );
  }
  if (result.type === "unavailable" || result.type === "upstream-failed") {
    return c.json(
      {
        detail:
          result.type === "upstream-failed"
            ? "Conversion failed upstream."
            : "Conversion service unavailable.",
      },
      502,
    );
  }
  if (result.type === "passthrough") return result.response;
  if (result.type === "bad-json") {
    return c.json({ detail: "Conversion response was not JSON." }, 502);
  }
  if (result.type === "store-failed") {
    return c.json({ detail: result.detail }, result.status);
  }
  return c.json(stripImageBytes(result.payload));
}

/** Async conversion: 202 immediately, client polls GET /v1/convert/jobs/:jobId. */
export async function runAsyncConvert(c: Ctx): Promise<Response> {
  const requestId = c.get("requestId") as string | undefined;
  let form: FormData;
  try {
    form = await c.req.formData();
  } catch {
    return c.json({ detail: "Invalid multipart body." }, 400);
  }
  const upload = parseConvertForm(form);
  if (!upload.ok) return c.json({ detail: upload.detail }, upload.status);

  const result = await startConversion(upload, requestId);
  if (result.type === "unavailable") {
    return c.json({ detail: "Conversion service unavailable." }, 502);
  }
  if (result.type === "queue-full") {
    return c.json(
      {
        detail: "Conversion queue is full, try again shortly.",
        code: "convert_queue_full",
      },
      429,
    );
  }
  if (result.type === "upstream-failed") {
    return c.json({ detail: "Conversion failed upstream." }, 502);
  }
  return result.response;
}

/** Sync conversion for guests and logged-in users (no workspace). */
converterRoutes.post("/convert", (c) =>
  runSyncConvert(c, { ownerId: ownerFromSession(c), workspaceId: null }),
);

/** Async conversion for guests and logged-in users (no workspace). */
converterRoutes.post("/convert/jobs", (c) => runAsyncConvert(c));

/** Get async job status. */
converterRoutes.get("/convert/jobs/:jobId", async (c) => {
  const jobId = c.req.param("jobId");
  if (!DOC_ID_RE.test(jobId)) return c.json({ detail: "Invalid job id." }, 400);
  const result = await getConversionJob(
    jobId,
    c.get("requestId") as string | undefined,
    { ownerId: ownerFromSession(c), workspaceId: null },
  );
  if (result.type === "not-found") {
    return c.json({ detail: "Job not found or expired." }, 404);
  }
  if (result.type === "unavailable") {
    return c.json({ detail: "Conversion service unavailable." }, 502);
  }
  if (result.type === "bad-json") {
    return c.json({ detail: "Conversion response was not JSON." }, 502);
  }
  if (result.type === "store-failed") {
    return c.json({ detail: result.detail }, result.status);
  }
  return c.json(stripImageBytes(result.job));
});

/** Cancel async job (queued or processing) */
converterRoutes.delete("/convert/jobs/:jobId", async (c) => {
  const jobId = c.req.param("jobId");
  if (!DOC_ID_RE.test(jobId)) return c.json({ detail: "Invalid job id." }, 400);
  const result = await cancelConversionJob(jobId);
  if (result.type === "not-found") {
    return c.json({ detail: "Job not found or expired." }, 404);
  }
  if (result.type === "conflict") {
    return c.json({ detail: "Cannot cancel completed or failed job." }, 409);
  }
  if (result.type === "unavailable") {
    return c.json({ detail: "Conversion service unavailable." }, 502);
  }
  return result.response;
});

export { converterRoutes };
