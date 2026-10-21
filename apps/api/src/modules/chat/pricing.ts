import { OPENAI_API_KEY, OPENAI_BASE_URL } from "../../config.js";
import { CHEAP_CHAT_MODELS, type ChatModelOption } from "./models.js";

/**
 * Model catalog served to the platform picker: curated cheap models with
 * $/token pricing. OpenRouter `/models` is fetched live (cached 6h) so prices
 * stay fresh; curated fallbacks keep the endpoint working offline.
 */
export interface ModelPrice {
  id: string;
  label: string;
  promptPerM: number;
  completionPerM: number;
  free: boolean;
}

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
let cache: { at: number; prices: ModelPrice[] } | null = null;

interface OpenRouterModel {
  id?: unknown;
  pricing?: { prompt?: unknown; completion?: unknown };
}

function toNumber(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

function mergeLive(
  curated: ChatModelOption[],
  live: Map<string, { promptPerM: number; completionPerM: number }>,
): ModelPrice[] {
  return curated.map((m) => {
    const p = live.get(m.id);
    return {
      id: m.id,
      label: m.label,
      promptPerM: p?.promptPerM ?? m.promptPerM,
      completionPerM: p?.completionPerM ?? m.completionPerM,
      free: Boolean(m.free),
    };
  });
}

async function fetchLivePrices(
  signal: AbortSignal,
): Promise<Map<string, { promptPerM: number; completionPerM: number }>> {
  const base = (OPENAI_BASE_URL || "https://openrouter.ai/api/v1").replace(
    /\/$/,
    "",
  );
  const res = await fetch(`${base}/models`, {
    signal,
    headers: OPENAI_API_KEY
      ? { Authorization: `Bearer ${OPENAI_API_KEY}` }
      : undefined,
  });
  if (!res.ok) throw new Error(`OpenRouter /models: HTTP ${res.status}`);
  const body = (await res.json()) as { data?: unknown };
  const out = new Map<string, { promptPerM: number; completionPerM: number }>();
  if (!Array.isArray(body.data)) return out;
  // OpenRouter quotes $/token; the catalog uses $/1M tokens. Round to 4
  // decimals so float noise (e.g. 0.09999999999999999) never reaches the UI.
  const round4 = (n: number) => Math.round(n * 10_000) / 10_000;
  for (const item of body.data as OpenRouterModel[]) {
    if (typeof item?.id !== "string") continue;
    const prompt = toNumber((item.pricing as { prompt?: unknown })?.prompt);
    const completion = toNumber(
      (item.pricing as { completion?: unknown })?.completion,
    );
    if (prompt === null || completion === null) continue;
    out.set(item.id, {
      promptPerM: round4(prompt * 1_000_000),
      completionPerM: round4(completion * 1_000_000),
    });
  }
  return out;
}

/** Test hook: clear the in-memory pricing cache. */
export function clearModelPriceCache(): void {
  cache = null;
}

/**
 * Curated model list with live-refreshed prices. Never throws: on any fetch
 * failure the curated fallback table is returned as-is.
 */
export async function getModelCatalog(): Promise<ModelPrice[]> {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_TTL_MS) return cache.prices;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const live = await fetchLivePrices(controller.signal);
      const prices = mergeLive(CHEAP_CHAT_MODELS, live);
      cache = { at: now, prices };
      return prices;
    } finally {
      clearTimeout(timeout);
    }
  } catch (err) {
    console.warn(
      `[models] live pricing unavailable, using curated fallback err=${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const fallback = mergeLive(CHEAP_CHAT_MODELS, new Map());
  cache = { at: now, prices: fallback };
  return fallback;
}
