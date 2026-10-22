/**
 * Client-side token/cost display state for the chat panel.
 *
 * @anvia/client carries usage at the TOP level of `turn_end`/`run_end`/`
 * message_end` frames; `protocol.ts` rebuilds those frames into `message_end`
 * events whose `metadata` the hook copies onto the message, where
 * `MessageUsage` and the session badge read it from. Per-part totals are
 * derived from the live `chat.messages` state.
 */
export interface TurnUsage {
  inputTokens: number;
  outputTokens: number;
  modelId: string;
}

export interface SessionUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  /** $ estimate using the active price table. */
  costUsd: number;
}

/** Total line for a turn (some providers only report in+out). */
export function turnTotal(turn: { inputTokens: number; outputTokens: number }): number {
  return turn.inputTokens + turn.outputTokens;
}

/** Format token counts for the footer (e.g. "1.2k in / 0.3k out"). */
export function formatTokens(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return `${Math.round(n)}`;
}

/** Format a USD cost estimate (e.g. "$0.0004"). */
export function formatCostUsd(cost: number): string {
  if (!Number.isFinite(cost) || cost < 0) return "—";
  if (cost === 0) return "$0";
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(2)}`;
}

/** Compact context-window size (e.g. 128000 → "128k"). */
export function formatContextTokens(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "—";
  return formatTokens(n);
}

/** $/1M-token price label (e.g. "$0.15"). */
export function formatPerMPrice(perM: number): string {
  if (!Number.isFinite(perM) || perM < 0) return "—";
  return `$${perM.toFixed(2)}`;
}

/**
 * Cost estimate for one turn: (input/1M × prompt price) + (output/1M ×
 * completion price).
 */
export function estimateTurnCost(
  turn: Pick<TurnUsage, "inputTokens" | "outputTokens">,
  promptPerM: number,
  completionPerM: number,
): number {
  return (
    (turn.inputTokens / 1_000_000) * promptPerM +
    (turn.outputTokens / 1_000_000) * completionPerM
  );
}
