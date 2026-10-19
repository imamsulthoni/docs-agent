import path from "node:path";
import { fileURLToPath } from "node:url";

const apiRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

export function env(name: string, fallback: string): string {
  const v = process.env[name];
  return v === undefined || v === "" ? fallback : v;
}

export function requiredEnv(name: string): string {
  const v = process.env[name];
  if (v === undefined || v === "") {
    throw new Error(`${name} is required`);
  }
  return v;
}

export const CONVERTER_URL = env(
  "CONVERTER_URL",
  "http://127.0.0.1:8379",
).replace(/\/$/, "");

export const CONVERTER_API_KEY = process.env.CONVERTER_API_KEY ?? "";

export const MAX_UPLOAD_MB = Number(env("MAX_UPLOAD_MB", "30"));
export const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;

/** Runtime conversion output. Served at /public; later swappable for object storage. */
export const ARTIFACT_DIR = path.resolve(
  env("ARTIFACT_DIR", path.join(apiRoot, "data", "public")),
);
export const ARTIFACT_MAX_MB = Number(env("ARTIFACT_MAX_MB", "1024"));
export const ARTIFACT_MAX_BYTES = ARTIFACT_MAX_MB * 1024 * 1024;

/**
 * Upper bound for a proxied conversion request (gateway → converter).
 * Large PDFs take minutes on the single-worker converter, far beyond
 * undici's default headers timeout — without this the request dies with
 * `HeadersTimeoutError` and the client only sees a bare 502.
 */
export const CONVERT_TIMEOUT_MS = Number(env("CONVERT_TIMEOUT_MS", "600000"));

export const DOC_ID_RE = /^[0-9a-f]{32}$/;

/**
 * Cross-workspace mentions travel outside the Anvia envelope (header, not
 * body) so `parseClientStreamRequest` keeps its contract. BRD §6.5/§9.
 */
export const MENTIONS_HEADER = "x-chat-mentions";
/** Max documents a single message may reference (BRD §9). */
export const MAX_MENTIONS_PER_MESSAGE = Number(
  env("MAX_MENTIONS_PER_MESSAGE", "3"),
);
/**
 * Chat attachments ride the same outside-the-envelope channel (BRD §6.5):
 * ids of already-processed attachments join the message via this header.
 */
export const ATTACHMENTS_HEADER = "x-chat-attachments";
export const MAX_ATTACHMENTS_PER_MESSAGE = Number(
  env("MAX_ATTACHMENTS_PER_MESSAGE", "5"),
);
/** Per-file upload cap for chat attachments (BRD §9: 5 MB). */
export const ATTACH_MAX_MB = Number(env("ATTACH_MAX_MB", "5"));
export const ATTACH_MAX_BYTES = ATTACH_MAX_MB * 1024 * 1024;
/** Image-OCR upstream round-trip — seconds per image, unlike PDF conversion. */
export const ATTACH_OCR_TIMEOUT_MS = Number(
  env("ATTACH_OCR_TIMEOUT_MS", "120000"),
);
/** Per-attachment prompt budget in chars; longer content is cut. */
export const ATTACH_MAX_CHARS = Number(env("ATTACH_MAX_CHARS", "50000"));
/** `processing` rows older than this report failed on the next poll. */
export const ATTACH_STALE_MS = Number(env("ATTACH_STALE_MS", "900000"));
/** Retrieved pages per document: the active doc gets more room than mentions. */
export const RETRIEVAL_TOP_K_ACTIVE = Number(env("RETRIEVAL_TOP_K_ACTIVE", "4"));
export const RETRIEVAL_TOP_K_MENTION = Number(
  env("RETRIEVAL_TOP_K_MENTION", "3"),
);
/** Hard cap on retrieved pages across the active doc + all mentions. */
export const RETRIEVAL_PAGE_BUDGET = Number(env("RETRIEVAL_PAGE_BUDGET", "10"));

/**
 * Memory identity string, namespaced by auth kind:
 * - `fp:<stable id>`  guest browser fingerprint (platform lib/identity.ts)
 * - `u:<userId>`      logged-in Better Auth user
 * Both flow into AgentMemorySession.userId; the prefix keeps them from
 * colliding and lets the API tell a guest from a registered user.
 */
export const USER_ID_RE = /^(fp|u):[A-Za-z0-9_-]{8,64}$/;

/** Logged-in identity string for a Better Auth user id. */
export function sessionUserId(userId: string): string {
  return `u:${userId}`;
}

export function parseSessionId(
  docId: string,
  sessionId: string,
): { ok: true } | { ok: false; detail: string } {
  const m = /^doc:([0-9a-f]{32}):s:([A-Za-z0-9_-]{8,64})$/.exec(sessionId);
  if (!m) return { ok: false, detail: "Invalid session id." };
  if (m[1] !== docId)
    return { ok: false, detail: "Session does not belong to this document." };
  return { ok: true };
}

export function newSessionId(docId: string, rand: string): string {
  return `doc:${docId}:s:${rand}`;
}

// ---- Persistence is required. OpenAI and Qdrant stay optional. ----

export const PUBLIC_BASE_URL = env(
  "PUBLIC_BASE_URL",
  "http://127.0.0.1:8377",
).replace(/\/$/, "");

/** Browser origins allowed to call the gateway (CORS + Better Auth trustedOrigins). */
export const PLATFORM_ORIGINS = env(
  "PLATFORM_URL",
  "http://127.0.0.1:8378,http://localhost:8378",
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// ---- Auth (Better Auth). See modules/auth. ----

/** Public URL of this gateway; Better Auth builds OAuth callbacks from it. */
export const BETTER_AUTH_URL = env(
  "BETTER_AUTH_URL",
  PUBLIC_BASE_URL,
).replace(/\/$/, "");
export const BETTER_AUTH_SECRET = process.env.BETTER_AUTH_SECRET ?? "";
export const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? "";
export const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET ?? "";

export const DATABASE_URL = requiredEnv("DATABASE_URL");
export const REDIS_URL = env("REDIS_URL", "redis://127.0.0.1:16379");
export const QDRANT_URL = env("QDRANT_URL", "http://127.0.0.1:6333");
export const QDRANT_API_KEY = process.env.QDRANT_API_KEY ?? "";
export const QDRANT_COLLECTION = env("QDRANT_COLLECTION", "document");

export const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? "";
export const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL ?? "";
export const CHAT_MODEL = env("CHAT_MODEL", "gpt-4o-mini");
/** User-led turns replayed to the model per request (summary anchors older context). */
export const CHAT_HISTORY_TURNS = Number(env("CHAT_HISTORY_TURNS", "6"));
/** Max agent turns (model/tool loop) per chat request before MaxTurnsError. */
export const CHAT_MAX_TURNS = Number(env("CHAT_MAX_TURNS", "5"));
export const SUMMARY_MODEL = env(
  "SUMMARY_MODEL",
  process.env.CHAT_MODEL ?? "gpt-4o-mini",
);
export const EMBEDDING_MODEL = env(
  "EMBEDDING_MODEL",
  "Xenova/all-MiniLM-L6-v2",
);
export const EMBEDDING_DIMS = Number(env("EMBEDDING_DIMS", "384"));

export const hasChatModel = OPENAI_API_KEY.length > 0;

export function converterHeaders(
  init?: HeadersInit,
  requestId?: string,
): Headers {
  const h = new Headers(init);
  if (CONVERTER_API_KEY) h.set("Authorization", `Bearer ${CONVERTER_API_KEY}`);
  if (requestId) h.set("x-request-id", requestId);
  return h;
}
