import type {
  MemoryAppendOptions,
  MemoryClearOptions,
  MemoryLoadOptions,
  MemoryStore,
  Message,
} from "@anvia/core";
import type { PrismaMemoryStore } from "@anvia/memory-prisma";
import { prisma } from "../../utils/prisma.js";
import { linkAttachmentsToRun } from "./attachments/service.js";

const QUESTION_RE = /<question>([\s\S]*?)<\/question>/;

/** Extract the raw question from a full RAG prompt (question + <context> pages). */
export function extractQuestion(text: string): string {
  const question = QUESTION_RE.exec(text)?.[1]?.trim();
  return question || text;
}

type LooseMessage = Message & { content?: unknown };

/** Drop retrieved <context> pages from a stored user message, keep the question. */
function stripPromptContext(message: Message): Message {
  const loose = message as LooseMessage;
  if (loose.role !== "user") return message;
  if (typeof loose.content === "string") {
    const question = extractQuestion(loose.content);
    return question === loose.content
      ? message
      : { ...loose, content: question };
  }
  if (Array.isArray(loose.content)) {
    let changed = false;
    const content = loose.content.map((part) => {
      if (
        part &&
        typeof part === "object" &&
        (part as { type?: unknown }).type === "text" &&
        typeof (part as { text?: unknown }).text === "string"
      ) {
        const text = (part as { text: string }).text;
        const question = extractQuestion(text);
        if (question !== text) {
          changed = true;
          return { ...part, text: question };
        }
      }
      return part;
    });
    return changed ? { ...loose, content } : message;
  }
  return message;
}

/** Keep whole user-led turns only: slice from the N-th last user message. */
function takeLastTurns(messages: Message[], maxTurns: number): Message[] {
  if (maxTurns <= 0 || messages.length === 0) return messages;
  const userIdx: number[] = [];
  messages.forEach((m, i) => {
    if ((m as { role?: unknown }).role === "user") userIdx.push(i);
  });
  if (userIdx.length <= maxTurns) return messages;
  const start = userIdx[userIdx.length - maxTurns] ?? 0;
  return messages.slice(start);
}

/** One document the user referenced with `@` for a single turn. */
export interface MentionSnapshot {
  docId: string;
  workspaceId: string | null;
  documentName: string;
}

/**
 * Lean-history decorator over the Prisma store:
 * - (A) persists + replays only the question, never the retrieved page context
 *   (fresh context is retrieved every turn anyway);
 * - (B) replays at most `maxTurns` recent turns; the document summary in the
 *   system instructions anchors older context.
 * UI history stays complete (loadHistory reads the raw store); the agent gets
 * the trimmed projection.
 *
 * `mentions` + `attachmentIds` are written once per run (when the user message
 * is appended) so the history endpoint can render `@` document chips and
 * attachment chips even though the Anvia envelope never carries that metadata.
 */
export class LeanHistoryStore implements MemoryStore {
  constructor(
    private readonly inner: PrismaMemoryStore,
    private readonly maxTurns: number,
    private readonly mentions: MentionSnapshot[] = [],
    private readonly attachmentIds: string[] = [],
  ) {}

  async load(options: MemoryLoadOptions): Promise<Message[]> {
    const messages = await this.inner.load(options);
    const stripped = messages.map(stripPromptContext);
    const trimmed = takeLastTurns(stripped, this.maxTurns);
    if (trimmed.length !== messages.length) {
      console.log(
        `[chat:history] session=${options.scope.sessionId} replay ${trimmed.length}/${messages.length} msgs (last ${this.maxTurns} turns)`,
      );
    }
    return trimmed;
  }

  async append(options: MemoryAppendOptions): Promise<void> {
    await this.inner.append({
      ...options,
      messages: options.messages.map(stripPromptContext),
    });
    await this.saveMentions(options);
    await this.saveAttachments(options);
  }

  private async saveMentions(options: MemoryAppendOptions): Promise<void> {
    if (this.mentions.length === 0) return;
    // `append` runs once per message batch; the user message marks the turn we
    // want to attach the chips to. runId is unique per chat request.
    const hasUser = options.messages.some(
      (m) => (m as { role?: unknown }).role === "user",
    );
    if (!hasUser) return;
    try {
      await prisma.chatMessageMention.createMany({
        data: this.mentions.map((m) => ({
          sessionId: options.scope.sessionId,
          runId: options.runId,
          turn: options.turn,
          docId: m.docId,
          workspaceId: m.workspaceId,
          documentName: m.documentName,
        })),
        skipDuplicates: true,
      });
    } catch (err) {
      // Chip metadata is a nicety: never fail the answer because of it.
      console.warn("[chat:mentions] persist failed", err);
    }
  }

  private async saveAttachments(options: MemoryAppendOptions): Promise<void> {
    if (this.attachmentIds.length === 0) return;
    const hasUser = options.messages.some(
      (m) => (m as { role?: unknown }).role === "user",
    );
    if (!hasUser) return;
    const ownerId = options.scope.userId;
    if (!ownerId) return;
    await linkAttachmentsToRun(
      ownerId,
      options.scope.sessionId,
      this.attachmentIds,
      options.runId,
    );
  }

  async clear(options: MemoryClearOptions): Promise<void> {
    await this.inner.clear(options);
    try {
      const sessionId = options.scope.sessionId;
      // A cleared session keeps no chips: mentions and attachments go with it.
      await prisma.chatMessageMention.deleteMany({ where: { sessionId } });
      await prisma.chatAttachment.deleteMany({ where: { sessionId } });
    } catch (err) {
      console.warn("[chat:history] chip cleanup failed", err);
    }
  }
}
