import type { AnyTool } from "@anvia/core";
import type { ClientStreamError } from "@anvia/client";
import {
  retrieveDocuments,
  vectorFilter,
} from "@anvia/core/vector-store";
import { OpenAIClient } from "@anvia/openai";
import { PrismaMemoryStore } from "@anvia/memory-prisma";
import type { Message } from "@anvia/core";
import {
  ATTACH_FOLLOWUP_MAX_CHARS,
  ATTACH_FOLLOWUP_TOTAL_MAX_CHARS,
  ATTACH_INJECT_MAX_CHARS,
  ATTACH_TOTAL_MAX_CHARS,
  CHAT_HISTORY_TURNS,
  CHAT_MAX_TURNS,
  OPENAI_API_KEY,
  OPENAI_BASE_URL,
  RETRIEVAL_PAGE_BUDGET,
  RETRIEVAL_TOP_K_ACTIVE,
  RETRIEVAL_TOP_K_MENTION,
  hasChatModel,
} from "../../config.js";
import { resolveChatModel } from "./models.js";
import {
  LeanHistoryStore,
  extractQuestion,
  type MentionSnapshot,
} from "./history-store.js";
import {
  listSessionAttachments,
  loadAttachmentChips,
  loadAttachmentContents,
  searchSessionAttachments,
  toAttachmentContexts,
  type AttachmentSearchHit,
  type ReadyAttachment,
  type UiAttachment,
} from "./attachments/service.js";
import { clipAttachments } from "./attachments/budget.js";
import {
  hasAttachmentIntent,
  matchAttachmentNames,
} from "./attachments/intent.js";
import { sanitizeFilename } from "./attachments/magic.js";
import { purgeSessionChips } from "./session-purge.js";
import { prisma } from "../../utils/prisma.js";
import { getOwnedMentionableDocs } from "../workspaces/service.js";
import {
  getEmbeddingModel,
  getVectorStore,
  retrieveForDocs,
  type PageMetadata,
} from "../../rag/vector.js";
import {
  buildAnswerPrompt,
  createAttachmentSearchTool,
  createDocAgent,
  createDocumentReadTool,
  createDocumentSearchTool,
  retrieveKeyword,
  toCitations,
  NotConfiguredError,
  type AttachmentCatalogEntry,
  type AttachmentContext,
  type Citation,
  type RetrievedPage,
} from "@docs-agent/agent";

export type ToolCallInfo = {
  callId: string;
  name: string;
  state: "running" | "done" | "error";
  input?: string;
  output?: string;
};

/**
 * Narrowing for helper markers the route swallows before agentToClientStream.
 * (Typed against the agent event union so unmapped cases fail the build.)
 */
export type AgentMarkerType = "citations" | "tool" | "done";

const AGENT_MARKERS: ReadonlySet<string> = new Set<string>([
  "citations",
  "tool",
  "done",
]);

export function isAgentMarker(type: string): type is AgentMarkerType {
  return AGENT_MARKERS.has(type);
}

export type ChatStreamEvent =
  | { type: "text_delta"; delta: string }
  | { type: "citations"; citations: Citation[] }
  | { type: "tool"; tool: ToolCallInfo }
  | { type: "done"; text: string }
  | { type: "error"; message: string };

export type HistoryMessage = { role: "user" | "assistant"; text: string };

function messageText(message: Message): string {
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (
          part &&
          typeof part === "object" &&
          (part as { type?: string }).type === "text"
        ) {
          return String((part as { text?: string }).text ?? "");
        }
        return "";
      })
      .join("");
  }
  return "";
}

let openai: OpenAIClient | null = null;
function getClient(): OpenAIClient {
  if (!hasChatModel)
    throw new NotConfiguredError("chat model (OPENAI_API_KEY)");
  if (!openai) {
    openai = new OpenAIClient({
      apiKey: OPENAI_API_KEY,
      ...(OPENAI_BASE_URL ? { baseUrl: OPENAI_BASE_URL } : {}),
    });
  }
  return openai;
}

function getMemoryStore(): PrismaMemoryStore {
  return new PrismaMemoryStore({ client: prisma });
}

export async function loadHistory(
  sessionId: string,
  userId: string,
): Promise<HistoryMessage[]> {
  const memory = getMemoryStore();
  const messages = await memory.load({ scope: { sessionId, userId } });
  return messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({
      role: m.role as "user" | "assistant",
      text: displayText(m),
    }))
    .filter((m) => m.text.length > 0);
}

export type UiToolPart = {
  id: string;
  type: "tool";
  toolName: string;
  toolCallId: string;
  callId?: string;
  state: "input-available" | "output-available" | "error";
  input?: unknown;
  output?: unknown;
};

export type UiPart =
  | { id: string; type: "text"; text: string }
  | { id: string; type: "reasoning"; text: string }
  | UiToolPart;

export type UiMessage = {
  id: string;
  role: "user" | "assistant";
  parts: UiPart[];
  metadata?: {
    mentions?: UiMention[];
    attachments?: UiAttachment[];
  };
};

/** A document chip rendered with the user message that referenced it. */
export type UiMention = {
  docId: string;
  documentName: string;
  workspaceId: string | null;
  /** True when the referenced document no longer exists. */
  deleted: boolean;
};

type CoreContentPart = { type?: unknown; [key: string]: unknown };

function coreContentParts(message: unknown): CoreContentPart[] {
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return [{ type: "text", text: content }];
  return Array.isArray(content) ? (content as CoreContentPart[]) : [];
}

/** Unwrap a core ToolResultOutput ({type:'text',value}) to its readable value. */
function toolOutputValue(output: unknown): unknown {
  if (output && typeof output === "object") {
    const o = output as { type?: unknown; value?: unknown };
    if (o.type === "text" && typeof o.value === "string") return o.value;
    if ("value" in o) return o.value;
  }
  return output;
}

function isErrorOutput(output: unknown): boolean {
  if (!output || typeof output !== "object") return false;
  const type = (output as { type?: unknown }).type;
  return type === "error-text" || type === "error-json";
}

type ToolResultInfo = { toolName: string; output: unknown; isError: boolean };

/** Index tool results by callId so they can be merged into the calling turn. */
function collectToolResults(
  messages: readonly unknown[],
): Map<string, ToolResultInfo> {
  const results = new Map<string, ToolResultInfo>();
  for (const message of messages) {
    if ((message as { role?: unknown }).role !== "tool") continue;
    for (const part of coreContentParts(message)) {
      if (part.type !== "tool-result") continue;
      const callId = part.callId;
      const toolCallId = part.toolCallId;
      const key =
        typeof callId === "string"
          ? callId
          : typeof toolCallId === "string"
            ? toolCallId
            : undefined;
      if (!key) continue;
      results.set(key, {
        toolName: typeof part.toolName === "string" ? part.toolName : "tool",
        output: toolOutputValue(part.output),
        isError: isErrorOutput(part.output),
      });
    }
  }
  return results;
}

/**
 * Mention chips per run, with a `deleted` flag for documents that are gone.
 * The name is a snapshot from send time, so a deleted document still renders.
 */
async function loadMentions(
  sessionId: string,
): Promise<Map<string, UiMention[]>> {
  const rows = await prisma.chatMessageMention.findMany({
    where: { sessionId },
    orderBy: { createdAt: "asc" },
    select: {
      runId: true,
      docId: true,
      documentName: true,
      workspaceId: true,
    },
  });
  if (rows.length === 0) return new Map();

  const docIds = [...new Set(rows.map((r) => r.docId))];
  const alive = await prisma.document.findMany({
    where: { id: { in: docIds } },
    select: { id: true },
  });
  const aliveIds = new Set(alive.map((d) => d.id));

  const byRun = new Map<string, UiMention[]>();
  for (const row of rows) {
    const list = byRun.get(row.runId) ?? [];
    list.push({
      docId: row.docId,
      documentName: row.documentName,
      workspaceId: row.workspaceId,
      deleted: !aliveIds.has(row.docId),
    });
    byRun.set(row.runId, list);
  }
  return byRun;
}

/**
 * History shaped for the chat UI: user/assistant messages whose parts carry
 * text, reasoning and tool calls, with tool results merged into the calling
 * turn. This keeps tool activity visible after a page refresh.
 */
export async function loadUiHistory(
  sessionId: string,
  userId: string,
): Promise<UiMessage[]> {
  // Read rows directly (not `memory.load`) because the mention chips are keyed
  // by `runId`, which the memory interface does not expose.
  const session = await prisma.agentMemorySession.findFirst({
    where: { sessionId, userId },
    select: { id: true },
  });
  if (!session) return [];

  const rows = await prisma.agentMemoryMessage.findMany({
    where: { memorySessionId: session.id },
    orderBy: { position: "asc" },
    select: { message: true, runId: true },
  });
  const messages = rows.map((row) => row.message as unknown as Message);
  const results = collectToolResults(messages);
  const mentionsByRun = await loadMentions(sessionId);
  let attachmentsByRun: Map<string, UiAttachment[]> | null = null;
  try {
    attachmentsByRun = await loadAttachmentChips(sessionId);
  } catch (err) {
    console.warn("[chat:history] attachment chips load failed", err);
  }
  const out: UiMessage[] = [];

  for (const [mi, message] of messages.entries()) {
    const role = (message as { role?: unknown }).role;
    const runId = rows[mi]?.runId;

    if (role === "user") {
      const parts: UiPart[] = [];
      for (const [pi, part] of coreContentParts(message).entries()) {
        if (part.type !== "text" || typeof part.text !== "string") continue;
        const text = extractQuestion(part.text).trim();
        if (text) parts.push({ id: `u${mi}_${pi}`, type: "text", text });
      }
      if (parts.length > 0) {
        const mentions = runId ? mentionsByRun.get(runId) : undefined;
        const attachments =
          runId && attachmentsByRun !== null
            ? attachmentsByRun.get(runId)
            : undefined;
        const metadata: UiMessage["metadata"] = {};
        if (mentions && mentions.length > 0) metadata.mentions = mentions;
        if (attachments && attachments.length > 0) {
          metadata.attachments = attachments;
        }
        out.push({
          id: `msg_${mi}`,
          role: "user",
          parts,
          ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
        });
      }
      continue;
    }

    if (role !== "assistant") continue;

    const parts: UiPart[] = [];
    for (const [pi, part] of coreContentParts(message).entries()) {
      if (
        part.type === "text" &&
        typeof part.text === "string" &&
        part.text.trim()
      ) {
        parts.push({ id: `a${mi}_${pi}`, type: "text", text: part.text });
      } else if (
        part.type === "reasoning" &&
        typeof part.text === "string" &&
        part.text.trim()
      ) {
        parts.push({ id: `a${mi}_${pi}`, type: "reasoning", text: part.text });
      } else if (part.type === "tool-call") {
        const callId =
          typeof part.callId === "string" ? part.callId : undefined;
        const toolCallId =
          typeof part.toolCallId === "string"
            ? part.toolCallId
            : (callId ?? `tool_${mi}_${pi}`);
        const result =
          results.get(callId ?? toolCallId) ?? results.get(toolCallId);
        parts.push({
          id: `tool_${mi}_${pi}`,
          type: "tool",
          toolName:
            typeof part.toolName === "string"
              ? part.toolName
              : (result?.toolName ?? "tool"),
          toolCallId,
          ...(callId ? { callId } : {}),
          state: result
            ? result.isError
              ? "error"
              : "output-available"
            : "input-available",
          input: part.input,
          ...(result ? { output: result.output } : {}),
        });
      }
    }
    if (parts.length > 0)
      out.push({ id: `msg_${mi}`, role: "assistant", parts });
  }

  return out;
}

/**
 * Display version of a stored message. The agent persists the full prompt
 * (question + retrieved <context> pages) as the user message so next turns
 * keep context — but the chat UI must only show the question itself.
 */
function displayText(message: Message): string {
  const text = messageText(message);
  if ((message as { role?: unknown }).role !== "user") return text;
  return extractQuestion(text);
}

export async function clearHistory(
  sessionId: string,
  userId: string,
): Promise<void> {
  const memory = getMemoryStore();
  await memory.clear({ scope: { sessionId, userId } });
  await purgeSessionChips(userId, sessionId);
}

/** Retrieval budget: the active document first, then each mention. */
export type RetrievalDoc = { docId: string; documentName: string; active?: boolean };

/**
 * Validate mention ids against the caller's own, indexed, workspace-scoped
 * documents. Any id that does not resolve rejects the whole request with a
 * generic 403: never reveal whether a foreign document exists.
 */
export async function resolveMentions(
  ownerId: string,
  docIds: string[],
): Promise<
  | { ok: true; mentions: MentionSnapshot[] }
  | { ok: false; status: 403; detail: string }
> {
  if (docIds.length === 0) return { ok: true, mentions: [] };
  const docs = await getOwnedMentionableDocs(ownerId, docIds);
  if (docs.length !== docIds.length) {
    return {
      ok: false,
      status: 403,
      detail: "One or more mentioned documents are not available.",
    };
  }
  return {
    ok: true,
    mentions: docs.map((d) => ({
      docId: d.doc_id,
      documentName: d.filename,
      workspaceId: d.workspace_id || null,
    })),
  };
}

/** Display name of a document (used for the active document in citations). */
export async function getDocumentName(docId: string): Promise<string> {
  const row = await prisma.document.findUnique({
    where: { id: docId },
    select: { name: true },
  });
  return row?.name ?? docId;
}

/**
 * Flatten per-document hits into one prompt list, honoring the per-document
 * top-k and the global page budget. Active document first so it can never be
 * crowded out by mentions. Pure helper (unit-tested).
 */
export function limitRetrievedPages(
  perDoc: Map<string, RetrievedPage[]>,
  docs: RetrievalDoc[],
  budget = RETRIEVAL_PAGE_BUDGET,
): RetrievedPage[] {
  const ordered = [...docs].sort(
    (a, b) => Number(Boolean(b.active)) - Number(Boolean(a.active)),
  );
  const result: RetrievedPage[] = [];
  for (const doc of ordered) {
    const limit = doc.active ? RETRIEVAL_TOP_K_ACTIVE : RETRIEVAL_TOP_K_MENTION;
    result.push(...(perDoc.get(doc.docId) ?? []).slice(0, limit));
  }
  return result.slice(0, budget);
}

/**
 * Retrieve pages for the active document plus its mentions.
 *
 * Top-k is per document (not global) so a mention cannot drown the active
 * document, and the combined result is capped by `RETRIEVAL_PAGE_BUDGET`.
 */
export async function retrievePagesForDocs(
  docs: RetrievalDoc[],
  question: string,
): Promise<RetrievedPage[]> {
  if (docs.length === 0) return [];
  const ordered = [...docs].sort(
    (a, b) => Number(Boolean(b.active)) - Number(Boolean(a.active)),
  );

  let vectorPages: RetrievedPage[] | null = null;
  try {
    vectorPages = await retrieveForDocs(
      ordered.map((d) => ({
        docId: d.docId,
        documentName: d.documentName,
        topK: d.active ? RETRIEVAL_TOP_K_ACTIVE : RETRIEVAL_TOP_K_MENTION,
      })),
      question,
    );
  } catch (err) {
    console.warn("[chat] vector retrieval failed, keyword fallback", err);
  }

  const perDoc = new Map<string, RetrievedPage[]>();
  if (vectorPages) {
    for (const page of vectorPages) {
      const key = page.docId ?? "";
      const list = perDoc.get(key) ?? [];
      list.push(page);
      perDoc.set(key, list);
    }
  }

  for (const doc of ordered) {
    if ((perDoc.get(doc.docId)?.length ?? 0) > 0) continue;
    // Keyword fallback is per document too, so every mention gets a chance.
    const rows = await prisma.documentPage.findMany({
      where: { documentId: doc.docId },
      orderBy: { pageNumber: "asc" },
      select: { pageNumber: true, content: true },
    });
    if (rows.length === 0) continue;
    const topK = doc.active ? RETRIEVAL_TOP_K_ACTIVE : RETRIEVAL_TOP_K_MENTION;
    const hits = retrieveKeyword(rows, question, topK).map((p) => ({
      ...p,
      docId: doc.docId,
      documentName: doc.documentName,
    }));
    perDoc.set(doc.docId, hits);
  }

  return limitRetrievedPages(perDoc, ordered);
}

async function readPageContent(
  docId: string,
  pageNumber: number,
): Promise<string | null> {
  const row = await prisma.documentPage.findUnique({
    where: { documentId_pageNumber: { documentId: docId, pageNumber } },
    select: { content: true },
  });
  return row?.content ?? null;
}

async function createToolsForDocuments(
  documents: RetrievalDoc[],
): Promise<AnyTool[]> {
  const scopes = documents.map((d) => ({
    docId: d.docId,
    documentName: d.documentName || d.docId,
    active: d.active,
  }));
  // Allow-list enforcement lives in the tool wrapper: `readPage`/`search` are
  // only ever wired for documents resolved server-side for this turn.
  const tools: AnyTool[] = [
    createDocumentReadTool({
      documents: scopes,
      readPage: (docId, pageNumber) => readPageContent(docId, pageNumber),
    }),
  ];
  try {
    const embeddingModel = await getEmbeddingModel();
    if (embeddingModel) {
      const store = getVectorStore();
      tools.unshift(
        createDocumentSearchTool({
          documents: scopes,
          search: async (docId, query) => {
            const results = await retrieveDocuments<RetrievedPage, PageMetadata>(
              {
                store,
                model: embeddingModel,
                query,
                topK: RETRIEVAL_TOP_K_MENTION,
                filter: vectorFilter.eq("documentId", docId),
              },
            );
            return results.map((r) => ({
              pageNumber: r.metadata?.pageNumber ?? 0,
              content: r.document.content,
              docId,
              documentName: r.metadata?.documentName,
            }));
          },
        }),
      );
    }
  } catch (err) {
    console.warn("[chat] search tool unavailable, using manual retrieval", err);
  }
  return tools;
}

export type ChatScope = { sessionId: string; userId: string };

type AttachmentTurn = {
  attachments: AttachmentContext[];
  catalog: AttachmentCatalogEntry[];
  search?: (query: string) => Promise<AttachmentSearchHit[]>;
};

/**
 * Decide what attachment text goes into this turn's prompt. Current-turn
 * uploads win; otherwise an intent-gated keyword lookup over the session's
 * ready attachments supplies either the file itself or a catalog to ask about.
 */
async function buildAttachmentTurn(
  question: string,
  current: ReadyAttachment[],
  scope: ChatScope,
): Promise<AttachmentTurn> {
  if (current.length > 0) {
    return {
      attachments: clipAttachments(current, {
        perFile: ATTACH_INJECT_MAX_CHARS,
        total: ATTACH_TOTAL_MAX_CHARS,
      }),
      catalog: [],
    };
  }
  if (!hasAttachmentIntent(question)) return { attachments: [], catalog: [] };

  const rows = await listSessionAttachments(scope.userId, scope.sessionId);
  if (rows.length === 0) return { attachments: [], catalog: [] };

  const catalogOf = (entries: typeof rows): AttachmentCatalogEntry[] =>
    entries.map((row) => ({
      name: sanitizeFilename(row.filename),
      ...(row.truncated ? { truncated: true } : {}),
    }));
  const search =
    rows.length >= 2
      ? (query: string) =>
          searchSessionAttachments(scope.userId, scope.sessionId, query)
      : undefined;

  const named = matchAttachmentNames(question, rows);
  if (named.length > 1) {
    return {
      attachments: [],
      catalog: catalogOf(named),
      ...(search ? { search } : {}),
    };
  }

  const pick = named.length === 1 ? named : rows.length === 1 ? rows : [];
  if (pick.length === 0) {
    return {
      attachments: [],
      catalog: catalogOf(rows),
      ...(search ? { search } : {}),
    };
  }

  const loaded = await loadAttachmentContents(
    scope.userId,
    scope.sessionId,
    [pick[0].id],
  );
  return {
    attachments: toAttachmentContexts(loaded, {
      perFile: ATTACH_FOLLOWUP_MAX_CHARS,
      total: ATTACH_FOLLOWUP_TOTAL_MAX_CHARS,
    }),
    catalog: [],
    ...(search ? { search } : {}),
  };
}

async function buildAgent(
  docId: string,
  summary: string | null,
  documents: RetrievalDoc[],
  mentions: MentionSnapshot[] = [],
  attachmentIds: string[] = [],
  attachmentSearch?: (query: string) => Promise<AttachmentSearchHit[]>,
  modelId?: string,
) {
  const model = getClient().completionModel({
    modelId: resolveChatModel(modelId),
    api: "chat",
  });
  const tools = await createToolsForDocuments(documents);
  if (attachmentSearch) {
    tools.push(createAttachmentSearchTool({ search: attachmentSearch }));
  }
  return createDocAgent({
    docId,
    model,
    summary,
    documents: documents.map((d) => ({
      docId: d.docId,
      documentName: d.documentName || d.docId,
      active: d.active,
    })),
    tools,
    maxTurns: CHAT_MAX_TURNS,
    memory: new LeanHistoryStore(
      getMemoryStore(),
      CHAT_HISTORY_TURNS,
      mentions,
      attachmentIds,
    ),
  });
}

/** Append an actionable hint when the chat model rejects the request (bad key / model id). */
function withUpstreamHint(message: string): string {
  if (/\b401\b/.test(message)) {
    return `${message} (API key ditolak upstream — cek OPENAI_API_KEY di .env, lalu restart dev:api. Untuk OpenRouter, CHAT_MODEL harus berbentuk 'openai/gpt-4o-mini'.)`;
  }
  return message;
}

/** One-line JSON/text summary for tool payloads shown in the chat UI. */
function shortJson(value: unknown, maxLen = 500): string {
  let s: string;
  try {
    s = typeof value === "string" ? value : JSON.stringify(value);
  } catch {
    s = String(value);
  }
  s = (s ?? "").replace(/\s+/g, " ").trim();
  return s.length > maxLen ? `${s.slice(0, maxLen - 1)}…` : s;
}

/** Extract readable output + error flag from a core ToolResultOutput payload. */
function toolOutputText(output: unknown): { text: string; isError: boolean } {
  if (output && typeof output === "object") {
    const o = output as { type?: unknown; value?: unknown };
    if (o.type === "error-text" || o.type === "error-json") {
      return { text: shortJson(o.value), isError: true };
    }
    if ("value" in o) return { text: shortJson(o.value), isError: false };
  }
  return { text: shortJson(output), isError: false };
}
/** Latest user turn from a client-protocol message list (drives retrieval + prompting). */
export function lastUserText(messages: readonly Message[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (!message || message.role !== "user") continue;
    const text = messageText(message).trim();
    if (text) return text;
  }
  return "";
}

/** Map any failure into a browser-safe client error (keeps the upstream-key hint). */
export function toClientError(error: unknown): ClientStreamError {
  return {
    message: withUpstreamHint(
      error instanceof Error ? error.message : "run failed",
    ),
  };
}

/**
 * Shared RAG setup: retrieved pages + prompt + agent. Streaming and ask share it.
 *
 * `documents` is the resolved allow-list for this turn (active doc + validated
 * mentions); `mentions` is the same list minus the active doc, used for chips.
 * `attachments` are validated upload contexts (injected into `<attachment>`).
 */
export async function prepareAnswer(
  docId: string,
  question: string,
  summary: string | null,
  mentions: MentionSnapshot[] = [],
  activeDocumentName = "",
  attachments: ReadyAttachment[] = [],
  scope: ChatScope,
  modelId?: string,
) {
  const resolvedModelId = resolveChatModel(modelId);
  const documents: RetrievalDoc[] = [
    { docId, documentName: activeDocumentName || docId, active: true },
    ...mentions.map((m) => ({
      docId: m.docId,
      documentName: m.documentName,
      active: false,
    })),
  ];
  const [pages, attachmentTurn] = await Promise.all([
    retrievePagesForDocs(documents, question),
    buildAttachmentTurn(question, attachments, scope),
  ]);
  const agent = await buildAgent(
    docId,
    summary,
    documents,
    mentions,
    attachments.map((a) => a.id),
    attachmentTurn.search,
    resolvedModelId,
  );
  return {
    pages,
    prompt: buildAnswerPrompt(
      question,
      pages,
      attachmentTurn.attachments,
      attachmentTurn.catalog,
    ),
    agent,
    modelId: resolvedModelId,
  };
}

/** Raw agent events for the platform stream. `streamAnswer` keeps citations for the CLI runner. */
export async function* streamAgentAnswer(
  docId: string,
  sessionId: string,
  userId: string,
  question: string,
  summary: string | null,
  mentions: MentionSnapshot[] = [],
  activeDocumentName = "",
  attachments: ReadyAttachment[] = [],
  modelId?: string,
) {
  const { prompt, agent } = await prepareAnswer(
    docId,
    question,
    summary,
    mentions,
    activeDocumentName,
    attachments,
    { sessionId, userId },
    modelId,
  );
  yield* agent.stream({
    prompt,
    session: { sessionId, userId, metadata: { docId } },
  });
}

/** Stream one answer over the turn's retrieved pages, persisting via memory. */
export async function* streamAnswer(
  docId: string,
  sessionId: string,
  userId: string,
  question: string,
  summary: string | null,
  mentions: MentionSnapshot[] = [],
  activeDocumentName = "",
  attachments: ReadyAttachment[] = [],
  modelId?: string,
): AsyncGenerator<ChatStreamEvent> {
  const { pages, prompt, agent } = await prepareAnswer(
    docId,
    question,
    summary,
    mentions,
    activeDocumentName,
    attachments,
    { sessionId, userId },
    modelId,
  );
  yield { type: "citations", citations: toCitations(pages) };

  const stream = agent.stream({
    prompt,
    session: { sessionId, userId, metadata: { docId } },
  });

  let text = "";
  try {
    for await (const event of stream) {
      if (event.type === "text_delta") {
        text += event.delta;
        yield { type: "text_delta", delta: event.delta };
      } else if (event.type === "response") {
        text = event.text || text;
      } else if (event.type === "tool_call") {
        const tc =
          (event as { toolCall?: Record<string, unknown> }).toolCall ?? {};
        const rawId = tc.toolCallId ?? tc.callId;
        yield {
          type: "tool",
          tool: {
            callId:
              typeof rawId === "string" && rawId ? rawId : `tool-${Date.now()}`,
            name:
              typeof tc.toolName === "string" && tc.toolName
                ? tc.toolName
                : "tool",
            state: "running",
            input: shortJson(tc.input),
          },
        };
      } else if (event.type === "tool_result") {
        const r = event as unknown as Record<string, unknown>;
        const rawId = r.toolCallId ?? r.callId;
        const { text: output, isError } = toolOutputText(r.output);
        yield {
          type: "tool",
          tool: {
            callId: typeof rawId === "string" && rawId ? rawId : "tool",
            name:
              typeof r.toolName === "string" && r.toolName
                ? r.toolName
                : "tool",
            state: isError ? "error" : "done",
            output,
          },
        };
      } else if (event.type === "error") {
        const err = (event as { error?: unknown }).error;
        const message = withUpstreamHint(
          err instanceof Error ? err.message : "run failed",
        );
        console.error(
          `[chat:answer] doc=${docId} session=${sessionId} UPSTREAM ERROR message=${message}`,
          err instanceof Error ? err.stack : "",
        );
        yield { type: "error", message };
        return;
      }
    }
  } catch (err) {
    const message = withUpstreamHint(
      err instanceof Error ? err.message : "run failed",
    );
    console.error(
      `[chat:answer] doc=${docId} session=${sessionId} STREAM FAILED message=${message}`,
      err instanceof Error ? err.stack : "",
    );
    yield { type: "error", message };
    return;
  }
  yield { type: "done", text };
}
