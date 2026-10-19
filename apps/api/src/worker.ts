import { Worker } from "bullmq";
import { generateCompletion } from "@anvia/core";
import { OpenAIClient } from "@anvia/openai";
import {
  OPENAI_API_KEY,
  OPENAI_BASE_URL,
  PUBLIC_BASE_URL,
  SUMMARY_MODEL,
} from "./config.js";
import { readMarkdown } from "./modules/documents/artifacts.js";
import { QUEUE_NAME, queueConnection } from "./config/queue-connection.js";
import { prisma } from "./utils/prisma.js";
import {
  absolutizePublicUrls,
  splitMarkdownPages,
  type RetrievedPage,
} from "@docs-agent/agent";
import { indexPages } from "./rag/vector.js";

async function fetchMarkdown(docId: string): Promise<string> {
  const text = await readMarkdown(docId);
  if (text === null) throw new Error("markdown unavailable");
  console.log(
    `[worker:fetch-markdown] doc=${docId} local bytes=${text.length}`,
  );
  return text;
}

async function summarize(pages: RetrievedPage[]): Promise<string | null> {
  if (!OPENAI_API_KEY) return null;

  try {
    const client = new OpenAIClient({
      apiKey: OPENAI_API_KEY,
      ...(OPENAI_BASE_URL ? { baseUrl: OPENAI_BASE_URL } : {}),
    });

    const model = client.completionModel({
      modelId: SUMMARY_MODEL,
      api: "chat",
    });

    const prompt = pages
      .slice(0, 4)
      .map((p, i) => `Page ${i + 1}\n${p.content}`)
      .join("\n\n");

    const result = await generateCompletion({
      model,
      instructions: "Summarize what this document is about. Keep it concise.",
      prompt,
      maxTokens: 500,
    });

    return result.text || null;
  } catch (err) {
    console.warn("[worker] summary failed", err);
    return null;
  }
}

const connection = queueConnection();

if (!connection) {
  console.error("[worker] REDIS_URL invalid; refusing to start.");
  process.exit(1);
}

export const worker = new Worker(
  QUEUE_NAME,
  async (job) => {
    const started = Date.now();
    const log = (stage: string, detail = "") =>
      console.log(
        `[worker:${stage}] doc=${job.data.docId ?? job.data.id} job=${job.id} ${detail}`.trim(),
      );
    const docId: string = job.data.docId ?? job.data.id;
    const name: string = job.data.name ?? "document";
    const markdownUrl: string | null = job.data.markdownUrl ?? null;
    log(
      "start",
      `name=${name} markdownUrl=${markdownUrl ?? "(null)"} attempt=${job.attemptsMade + 1}`,
    );

    let raw: string;
    try {
      raw = await fetchMarkdown(docId);
      log(
        "fetch-markdown",
        `ok bytes=${raw.length} elapsed=${Date.now() - started}ms`,
      );
    } catch (err) {
      console.error(
        `[worker:fetch-markdown] doc=${docId} FAILED err=${err instanceof Error ? err.message : String(err)}`,
        err instanceof Error ? err.stack : "",
      );
      throw err;
    }

    const markdown = absolutizePublicUrls(raw, PUBLIC_BASE_URL);
    const pages = splitMarkdownPages(markdown);
    log("split", `pages=${pages.length}`);
    if (pages.length === 0) {
      console.error(
        `[worker:split] doc=${docId} markdown has no pages (bytes=${raw.length})`,
      );
      throw new Error("markdown has no pages");
    }

    let summary: string | null = null;
    try {
      log("summarize", "start");
      summary = await summarize(pages);
      log(
        "summarize",
        summary
          ? `ok chars=${summary.length}`
          : "skipped/empty (no OPENAI_API_KEY or failed)",
      );
    } catch (err) {
      console.error(
        `[worker:summarize] doc=${docId} FAILED err=${err instanceof Error ? err.message : String(err)}`,
      );
      summary = null;
    }

    try {
      log("db-write", `start pages=${pages.length}`);
      await prisma.$transaction([
        prisma.documentPage.deleteMany({ where: { documentId: docId } }),
        prisma.documentPage.createMany({
          data: pages.map((p) => ({
            documentId: docId,
            pageNumber: p.pageNumber,
            content: p.content,
            metadata: { source: "converter" },
          })),
        }),
        prisma.document.update({
          where: { id: docId },
          data: { summary, markdownUrl, isProcessed: true },
        }),
      ]);
      log("db-write", `ok isProcessed=true elapsed=${Date.now() - started}ms`);
    } catch (err) {
      console.error(
        `[worker:db-write] doc=${docId} FAILED err=${err instanceof Error ? err.message : String(err)}`,
        err instanceof Error ? err.stack : "",
      );
      throw err;
    }

    // Best-effort vector index; keyword fallback still works without Qdrant.
    // NOTE: embedding failure does NOT block `indexed` — db-write above already set isProcessed=true.
    let vectorIndexed = false;
    try {
      log("vector-index", "start");
      vectorIndexed = await indexPages(docId, name, pages);
      log(
        "vector-index",
        vectorIndexed
          ? "ok"
          : "skipped (embedding model unavailable, keyword fallback active)",
      );
    } catch (err) {
      console.warn(
        `[worker:vector-index] doc=${docId} FAILED, keyword fallback will be used err=${err instanceof Error ? err.message : String(err)}`,
        err instanceof Error ? err.stack : "",
      );
    }

    log(
      "done",
      `pages=${pages.length} vectorIndexed=${vectorIndexed} elapsed=${Date.now() - started}ms`,
    );
    return { docId, pages: pages.length, vectorIndexed };
  },
  { connection },
);

worker.on("completed", (job, result) =>
  console.log(`[worker:completed] doc=${job.data.docId} job=${job.id}`, result),
);
worker.on("failed", (job, err) =>
  console.error(
    `[worker:failed] doc=${job?.data?.docId} job=${job?.id} attempts=${job?.attemptsMade} err=${err.message}`,
    err.stack,
  ),
);
console.log("[worker] listening for document indexing jobs");
