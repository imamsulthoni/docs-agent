import { CHAT_MODEL } from "../../config.js";

/**
 * Chat model catalog for the per-session model picker. OpenRouter stays the
 * provider; the UI only offers cheap models.
 *
 * Each entry carries fallback $/1M-token prices (last checked Oct 2026 — live
 * prices can drift, GET /v1/models refreshes them from OpenRouter when the
 * network allows). `CHAT_MODEL_DEFAULT_ID` pins the curated entry that the
 * request-time resolver falls back to; the actual runtime default is still
 * env `CHAT_MODEL`.
 */
export interface ChatModelOption {
  id: string;
  label: string;
  /** $ per 1M prompt tokens (fallback). */
  promptPerM: number;
  /** $ per 1M completion tokens (fallback). */
  completionPerM: number;
  free?: boolean;
  /** Reasoning-capable (thinking) model, used when live data is unavailable. */
  reasoning?: boolean;
}

export const CHEAP_CHAT_MODELS: ChatModelOption[] = [
  {
    id: "openai/gpt-4o-mini",
    label: "GPT-4o mini",
    promptPerM: 0.15,
    completionPerM: 0.6,
  },
  {
    id: "google/gemini-2.5-flash",
    label: "Gemini 2.5 Flash",
    promptPerM: 0.3,
    completionPerM: 2.5,
    reasoning: true,
  },
  {
    id: "meta-llama/llama-3.3-70b-instruct",
    label: "Llama 3.3 70B",
    promptPerM: 0.12,
    completionPerM: 0.3,
  },
  {
    id: "qwen/qwen-2.5-72b-instruct",
    label: "Qwen 2.5 72B",
    promptPerM: 0.35,
    completionPerM: 0.4,
  },
  {
    id: "deepseek/deepseek-chat-v3-0324",
    label: "DeepSeek V3",
    promptPerM: 0.3,
    completionPerM: 0.85,
  },
  {
    id: "meta-llama/llama-3.3-70b-instruct:free",
    label: "Llama 3.3 70B (free)",
    promptPerM: 0,
    completionPerM: 0,
    free: true,
  },
];

/** Env override: extra comma-separated model ids (any OpenRouter id allowed). */
function extraModelIds(): string[] {
  return (process.env.CHAT_MODEL_OPTIONS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Full allowlist: curated cheap models + env CHAT_MODEL + env extras.
 * Per-request model choices are validated against this — anything else is
 * ignored and the request falls back to CHAT_MODEL.
 */
export function chatModelAllowlist(): string[] {
  const ids = new Set<string>([
    ...CHEAP_CHAT_MODELS.map((m) => m.id),
    CHAT_MODEL,
    ...extraModelIds(),
  ]);
  return [...ids];
}

/**
 * Resolve the client-requested model against the allowlist. Unknown, empty or
 * missing values fall back to env CHAT_MODEL (never trust raw client input).
 */
export function resolveChatModel(requested: string | undefined): string {
  const id = requested?.trim() ?? "";
  if (id && chatModelAllowlist().includes(id)) return id;
  return CHAT_MODEL;
}
