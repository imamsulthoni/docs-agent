import type { AttachmentContext } from "@docs-agent/agent";

export type ClipBudget = { perFile: number; total: number };

/**
 * Apply per-file and total char budgets. Files with no room left are dropped;
 * clipped content is marked `truncated` so the prompt tells the model why.
 */
export function clipAttachments(
  attachments: readonly AttachmentContext[],
  { perFile, total }: ClipBudget,
): AttachmentContext[] {
  const out: AttachmentContext[] = [];
  let remaining = total;
  for (const attachment of attachments) {
    if (remaining <= 0) break;
    const allowed = Math.min(perFile, remaining);
    const clipped = attachment.content.slice(0, allowed);
    remaining -= clipped.length;
    out.push(
      clipped.length < attachment.content.length
        ? { ...attachment, content: clipped, truncated: true }
        : attachment,
    );
  }
  return out;
}
