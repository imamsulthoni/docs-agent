/**
 * Attachment sniffing + shaping helpers (pure, unit-testable).
 *
 * File type is decided from magic bytes in the body — never the client's
 * MIME/extension claim (BRD §6.7). TXT/MD have no magic markers, so the
 * extension is the only signal for those, capped by size and parsed as
 * UTF-8 on acceptance.
 */

export type AttachmentKind = "pdf" | "image" | "text";

export type SniffedAttachment = {
  kind: AttachmentKind;
  /** Canonical mime recorded on the row (client claims are ignored). */
  mime: string;
};

function startsWith(buffer: Buffer, magic: number[]): boolean {
  if (buffer.length < magic.length) return false;
  return magic.every((byte, index) => buffer[index] === byte);
}

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG = [0xff, 0xd8, 0xff];
const TIFF_LE = [0x49, 0x49, 0x2a, 0x00];
const TIFF_BE = [0x4d, 0x4d, 0x00, 0x2a];

/**
 * Map a body buffer to an accepted attachment kind. Returns null for
 * anything outside PDF / PNG / JPEG / WebP / TIFF / .txt / .md.
 */
export function sniffAttachment(
  buffer: Buffer,
  filename: string,
): SniffedAttachment | null {
  if (startsWith(buffer, [0x25, 0x50, 0x44, 0x46, 0x2d])) {
    return { kind: "pdf", mime: "application/pdf" };
  }
  if (startsWith(buffer, PNG)) return { kind: "image", mime: "image/png" };
  if (startsWith(buffer, JPEG)) return { kind: "image", mime: "image/jpeg" };
  if (
    startsWith(buffer, [0x52, 0x49, 0x46, 0x46]) &&
    startsWith(buffer.subarray(8), [0x57, 0x45, 0x42, 0x50])
  ) {
    return { kind: "image", mime: "image/webp" };
  }
  if (startsWith(buffer, TIFF_LE) || startsWith(buffer, TIFF_BE)) {
    return { kind: "image", mime: "image/tiff" };
  }
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  if (ext === "txt") return { kind: "text", mime: "text/plain" };
  if (ext === "md" || ext === "markdown") {
    return { kind: "text", mime: "text/markdown" };
  }
  return null;
}

/** Path-safe file name for storage + display (client names are hostile). */
export function sanitizeFilename(name: string, fallback = "lampiran"): string {
  const base = name
    .replace(/[\\/]+/g, "-")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim();
  return base ? base.slice(0, 150) : fallback;
}

/**
 * Cut content at the per-attachment budget. The marker is appended verbatim
 * so the model knows the text is partial; `truncated` drives the chip notice.
 */
export function truncateAttachmentContent(
  content: string,
  maxChars: number,
): { content: string; truncated: boolean } {
  if (maxChars <= 0 || content.length <= maxChars) {
    return { content, truncated: false };
  }
  return {
    content: `${content.slice(0, Math.max(0, maxChars))}\n\n[dipotong — lampiran terlalu panjang]`,
    truncated: true,
  };
}
