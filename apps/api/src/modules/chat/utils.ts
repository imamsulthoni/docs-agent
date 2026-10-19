import { parseClientStreamRequest } from "@anvia/client";
import {
  DOC_ID_RE,
  MAX_ATTACHMENTS_PER_MESSAGE,
  MAX_MENTIONS_PER_MESSAGE,
  USER_ID_RE,
  parseSessionId,
} from "../../config.js";
import { lastUserText } from "./service.js";

function readUserId(header: string | undefined): string | null {
  const raw = header?.trim();
  if (!raw || !USER_ID_RE.test(raw)) return null;
  return raw;
}

export type ChatScope =
  | { ok: true; docId: string; sessionId: string; userId: string }
  | { ok: false; status: 400 | 404; detail: string };

/**
 * Path + identity checks shared by chat session routes.
 *
 * `authUserId` is the server-derived identity of a logged-in user (`u:<id>`,
 * from the session — never trusted from the client). When present it wins over
 * the `x-user-id` fingerprint header, which stays the guest fallback.
 */
export function readChatScope(
  docId: string,
  sessionId: string,
  userIdHeader: string | undefined,
  authUserId?: string | null,
): ChatScope {
  if (!DOC_ID_RE.test(docId)) {
    return { ok: false, status: 404, detail: "Invalid doc_id." };
  }
  const sess = parseSessionId(docId, sessionId);
  if (!sess.ok) return { ok: false, status: 400, detail: sess.detail };
  const userId =
    authUserId && USER_ID_RE.test(authUserId)
      ? authUserId
      : readUserId(userIdHeader);
  if (!userId) {
    return {
      ok: false,
      status: 400,
      detail: "Missing or invalid x-user-id header.",
    };
  }
  return { ok: true, docId, sessionId, userId };
}

export type ParsedQuestion =
  | { ok: true; question: string }
  | { ok: false; status: 400 | 422; detail: string };/** Latest user text from a client-protocol stream body. */
export function parseChatQuestion(body: unknown): ParsedQuestion {
  try {
    const parsed = parseClientStreamRequest(body);
    if (parsed.type !== "messages") {
      return {
        ok: false,
        status: 400,
        detail: "Only message streams are supported.",
      };
    }
    const question = lastUserText(parsed.messages);
    if (!question) {
      return {
        ok: false,
        status: 422,
        detail: 'Field "question" is required.',
      };
    }
    if (question.length > 2000) {
      return {
        ok: false,
        status: 422,
        detail: 'Field "question" exceeds 2000 characters.',
      };
    }
    return { ok: true, question };
  } catch {
    return { ok: false, status: 422, detail: "Invalid stream request." };
  }
}

export type ParsedMentions =
  | { ok: true; docIds: string[] }
  | { ok: false; status: 400 | 403 | 422; detail: string };

/**
 * Parse the `x-chat-mentions` header: comma-separated doc ids for one message.
 *
 * Mentions are an account feature, so guests are rejected even if they forge
 * the header. The active document is dropped silently (it is already context).
 * Ownership is checked separately against the database.
 */
export function parseMentionHeader(
  header: string | undefined,
  activeDocId: string,
  isGuest: boolean,
): ParsedMentions {
  const raw = header?.trim() ?? "";
  if (!raw) return { ok: true, docIds: [] };
  if (isGuest) {
    return {
      ok: false,
      status: 403,
      detail: "Mentions require an account.",
    };
  }
  const ids = [...new Set(raw.split(",").map((s) => s.trim()).filter(Boolean))];
  const invalid = ids.find((id) => !DOC_ID_RE.test(id));
  if (invalid !== undefined) {
    return { ok: false, status: 400, detail: "Invalid mention id." };
  }
  const docIds = ids.filter((id) => id !== activeDocId);
  if (docIds.length > MAX_MENTIONS_PER_MESSAGE) {
    return {
      ok: false,
      status: 422,
      detail: `At most ${MAX_MENTIONS_PER_MESSAGE} documents can be mentioned per message.`,
    };
  }
  return { ok: true, docIds };
}

export type ParsedAttachments =
  | { ok: true; attachmentIds: string[] }
  | { ok: false; status: 400 | 403 | 422; detail: string };

/**
 * Parse the `x-chat-attachments` header: comma-separated attachment row ids
 * (cuid) already uploaded for this message. Attachments are an account
 * feature, so guests are rejected like forged mention headers.
 */
export function parseAttachmentHeader(
  header: string | undefined,
  isGuest: boolean,
): ParsedAttachments {
  const raw = header?.trim() ?? "";
  if (!raw) return { ok: true, attachmentIds: [] };
  if (isGuest) {
    return {
      ok: false,
      status: 403,
      detail: "Attachments require an account.",
    };
  }
  const ids = [...new Set(raw.split(",").map((s) => s.trim()).filter(Boolean))];
  const invalid = ids.find((id) => !/^[A-Za-z0-9_-]{20,40}$/.test(id));
  if (invalid !== undefined) {
    return { ok: false, status: 400, detail: "Invalid attachment id." };
  }
  if (ids.length > MAX_ATTACHMENTS_PER_MESSAGE) {
    return {
      ok: false,
      status: 422,
      detail: `At most ${MAX_ATTACHMENTS_PER_MESSAGE} attachments can be sent per message.`,
    };
  }
  return { ok: true, attachmentIds: ids };
}
