import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import {
  ATTACH_MAX_BYTES,
  ATTACH_MAX_MB,
  MAX_ATTACHMENTS_PER_MESSAGE,
  parseSessionId,
  sessionUserId,
} from "../../../config.js";
import {
  loadSession,
  requireAuth,
  type AuthVariables,
} from "../../auth/middleware.js";
import {
  countOpenAttachments,
  createAttachmentRow,
  deleteAttachment,
  getAttachment,
  startAttachmentProcessing,
  toAttachmentResult,
} from "./service.js";
import { sanitizeFilename, sniffAttachment } from "./magic.js";

type Ctx = Context<{ Variables: AuthVariables }>;

const attachmentRoutes = new Hono<{ Variables: AuthVariables }>();

// Resolve the session once; requireAuth rejects guests per route.
attachmentRoutes.use("/*", loadSession);

/** Attachment ownership string (`u:<id>`) — same variant as Document.ownerId. */
function ownerIdFrom(c: Ctx): string {
  const user = c.get("user");
  return sessionUserId((user as { id: string }).id);
}

attachmentRoutes.post(
  "/chat/:docId/attachments",
  requireAuth,
  bodyLimit({ maxSize: ATTACH_MAX_BYTES + 512 * 1024 }),
  async (c) => {
    const requestId = c.get("requestId") as string | undefined;
    const docId = c.req.param("docId");
    const ownerId = ownerIdFrom(c);

    let form: FormData;
    try {
      form = await c.req.formData();
    } catch {
      return c.json({ detail: "Invalid multipart body." }, 400);
    }
    const file = form.get("file");
    if (!(file instanceof File)) {
      return c.json({ detail: 'Field "file" is required.' }, 422);
    }
    if (file.size === 0) {
      return c.json({ detail: "File kosong." }, 422);
    }
    if (file.size > ATTACH_MAX_BYTES) {
      return c.json(
        { detail: `File exceeds the ${ATTACH_MAX_MB} MB attachment limit.` },
        413,
      );
    }

    // Client-side session attribution; shape-validated, ownership checked at send.
    const sessionId = (form.get("session_id")?.toString() ?? "").trim();
    if (sessionId) {
      const parsed = parseSessionId(docId, sessionId);
      if (!parsed.ok) return c.json({ detail: parsed.detail }, 400);
      if (
        (await countOpenAttachments(ownerId, sessionId)) >=
        MAX_ATTACHMENTS_PER_MESSAGE
      ) {
        return c.json(
          { detail: `At most ${MAX_ATTACHMENTS_PER_MESSAGE} attachments per message.` },
          422,
        );
      }
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const sniffed = sniffAttachment(buffer, file.name);
    if (!sniffed) {
      return c.json(
        {
          detail:
            "Tipe file tidak didukung. Gunakan PDF, TXT, MD, PNG, JPG, WebP, atau TIFF.",
        },
        415,
      );
    }

    const filename = sanitizeFilename(file.name);
    const row = await createAttachmentRow({
      ownerId,
      docId,
      sessionId,
      filename,
      mimeType: sniffed.mime,
      sizeBytes: file.size,
    });

    // Kick off in-process processing; the client polls until ready/failed.
    startAttachmentProcessing({
      id: row.id,
      kind: sniffed.kind,
      mime: sniffed.mime,
      buffer,
      filename,
      requestId,
    });
    return c.json({ ...toAttachmentResult(row), doc_id: docId }, 202);
  },
);

attachmentRoutes.get(
  "/chat/:docId/attachments/:attachmentId",
  requireAuth,
  async (c) => {
    const row = await getAttachment(
      ownerIdFrom(c),
      c.req.param("attachmentId"),
    );
    if (!row) return c.json({ detail: "Attachment not found." }, 404);
    return c.json(toAttachmentResult(row));
  },
);

attachmentRoutes.delete(
  "/chat/:docId/attachments/:attachmentId",
  requireAuth,
  async (c) => {
    const row = await deleteAttachment(
      ownerIdFrom(c),
      c.req.param("attachmentId"),
    );
    if (!row) return c.json({ detail: "Attachment not found." }, 404);
    return c.json(row);
  },
);

export { attachmentRoutes };
