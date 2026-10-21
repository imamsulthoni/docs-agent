import { Hono, type Context } from "hono";
import { agentToClientStream } from "@anvia/client";
import { createClientStreamResponse } from "@anvia/server";
import { NotConfiguredError } from "@docs-agent/agent";
import { ATTACHMENTS_HEADER, MENTIONS_HEADER, sessionUserId } from "../../config.js";
import { loadSession, type AuthVariables } from "../auth/middleware.js";
import { chatRateLimit } from "../../middleware/rateLimit.js";
import { isDocAccessible } from "../documents/access.js";
import { getDocStatus } from "../documents/store.js";
import type { MentionSnapshot } from "./history-store.js";
import {
  clearHistory,
  getDocumentName,
  loadUiHistory,
  resolveMentions,
  streamAgentAnswer,
  toClientError,
} from "./service.js";
import { resolveReadyAttachments } from "./attachments/service.js";
import type { ReadyAttachment } from "./attachments/service.js";
import {
  parseAttachmentHeader,
  parseChatQuestion,
  parseMentionHeader,
  readChatScope,
} from "./utils.js";

const chatRoutes = new Hono<{ Variables: AuthVariables }>();

// Resolve the session once per request: a logged-in user's identity (`u:<id>`)
// takes precedence over the guest fingerprint header.
chatRoutes.use("/*", loadSession);

/** Server-derived identity for chat memory, or null for guests. */
function chatIdentity(c: Context<{ Variables: AuthVariables }>): string | null {
  const user = c.get("user");
  return user ? sessionUserId(user.id) : null;
}

chatRoutes.get("/chat/:docId/:sessionId", async (c) => {
  const scope = readChatScope(
    c.req.param("docId"),
    c.req.param("sessionId"),
    c.req.header("x-user-id"),
    chatIdentity(c),
  );
  if (!scope.ok) return c.json({ detail: scope.detail }, scope.status);
  if (!(await isDocAccessible(scope.docId, chatIdentity(c)))) {
    return c.json({ detail: "Not found." }, 404);
  }
  try {
    const messages = await loadUiHistory(scope.sessionId, scope.userId);
    return c.json({ sessionId: scope.sessionId, messages });
  } catch (err) {
    if (err instanceof NotConfiguredError) {
      return c.json({ detail: err.message }, 503);
    }
    throw err;
  }
});

chatRoutes.delete("/chat/:docId/:sessionId", async (c) => {
  const scope = readChatScope(
    c.req.param("docId"),
    c.req.param("sessionId"),
    c.req.header("x-user-id"),
    chatIdentity(c),
  );
  if (!scope.ok) return c.json({ detail: scope.detail }, scope.status);
  if (!(await isDocAccessible(scope.docId, chatIdentity(c)))) {
    return c.json({ detail: "Not found." }, 404);
  }
  try {
    await clearHistory(scope.sessionId, scope.userId);
    return c.json({ sessionId: scope.sessionId, cleared: true });
  } catch (err) {
    if (err instanceof NotConfiguredError) {
      return c.json({ detail: err.message }, 503);
    }
    throw err;
  }
});

chatRoutes.post("/chat/:docId/:sessionId", chatRateLimit, async (c) => {
  const scope = readChatScope(
    c.req.param("docId"),
    c.req.param("sessionId"),
    c.req.header("x-user-id"),
    chatIdentity(c),
  );
  if (!scope.ok) return c.json({ detail: scope.detail }, scope.status);
  const identity = chatIdentity(c);
  // Private docs (owned) must never be readable by other accounts or guests,
  // even when the opaque docId leaks. Guest docs stay open as before.
  if (!(await isDocAccessible(scope.docId, identity))) {
    return c.json({ detail: "Not found." }, 404);
  }

  const parsed = parseChatQuestion(await c.req.json().catch(() => null));
  if (!parsed.ok) return c.json({ detail: parsed.detail }, parsed.status);

  const parsedMentions = parseMentionHeader(
    c.req.header(MENTIONS_HEADER),
    scope.docId,
    identity === null,
  );
  if (!parsedMentions.ok) {
    return c.json({ detail: parsedMentions.detail }, parsedMentions.status);
  }
  let mentions: MentionSnapshot[] = [];
  if (parsedMentions.docIds.length > 0) {
    // parseMentionHeader already rejects guests, so identity is non-null here.
    const resolved = await resolveMentions(identity as string, parsedMentions.docIds);
    if (!resolved.ok) {
      return c.json({ detail: resolved.detail }, resolved.status);
    }
    mentions = resolved.mentions;
  }

  const parsedAttachments = parseAttachmentHeader(
    c.req.header(ATTACHMENTS_HEADER),
    identity === null,
  );
  if (!parsedAttachments.ok) {
    return c.json({ detail: parsedAttachments.detail }, parsedAttachments.status);
  }
  let attachments: ReadyAttachment[] = [];
  if (parsedAttachments.attachmentIds.length > 0) {
    const resolved = await resolveReadyAttachments(
      identity as string,
      scope.sessionId,
      parsedAttachments.attachmentIds,
    );
    if (!resolved.ok) {
      return c.json({ detail: resolved.detail }, resolved.status);
    }
    attachments = resolved.attachments;
  }

  const status = await getDocStatus(scope.docId);
  if (!status.found || !status.isProcessed) {
    return c.json(
      { detail: "Document is still indexing, try again shortly." },
      503,
    );
  }

  const activeDocumentName = await getDocumentName(scope.docId);

  return createClientStreamResponse({
    events: agentToClientStream({
      events: streamAgentAnswer(
        scope.docId,
        scope.sessionId,
        scope.userId,
        parsed.question,
        status.summary,
        mentions,
        activeDocumentName,
        attachments,
      ),
      mapError: (error) => {
        console.error(
          `[chat:answer] doc=${scope.docId} session=${scope.sessionId} stream error`,
          error instanceof Error ? (error.stack ?? error.message) : error,
        );
        return toClientError(error);
      },
    }),
    format: "jsonl",
    headers: { "cache-control": "no-cache", "x-accel-buffering": "no" },
  });
});

export { chatRoutes };
