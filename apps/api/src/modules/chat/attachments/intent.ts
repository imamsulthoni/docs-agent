/** Normalize free text for keyword/name matching (lowercase, alnum words). */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

const INTENT_KEYWORDS = new Set([
  "lampiran",
  "attachment",
  "attachments",
  "file",
  "files",
  "berkas",
  "upload",
  "uploads",
  "unggah",
  "terlampir",
]);

const INTENT_PHRASES = [
  "yang saya upload",
  "yang saya unggah",
  "yang saya lampirkan",
  "file tadi",
  "gambar tadi",
  "pdf tadi",
  "excel tadi",
  "csv tadi",
  "word tadi",
  "screenshot tadi",
];

/**
 * True when the question refers to an earlier upload. Bare `dokumen` is
 * intentionally excluded — it usually means the workspace document.
 */
export function hasAttachmentIntent(question: string): boolean {
  const text = normalize(question);
  if (!text) return false;
  if (INTENT_PHRASES.some((phrase) => text.includes(phrase))) return true;
  return text.split(" ").some((word) => INTENT_KEYWORDS.has(word));
}

/** Tokens used for keyword scoring; drops very short words. */
export function searchTokens(query: string): string[] {
  return [...new Set(normalize(query).split(" ").filter((w) => w.length >= 3))];
}

function baseName(filename: string): string {
  return normalize(filename.replace(/\.[a-z0-9]{1,8}$/i, ""));
}

/** Attachments whose file name (without extension) appears in the question. */
export function matchAttachmentNames<T extends { filename: string }>(
  question: string,
  rows: readonly T[],
): T[] {
  const text = normalize(question);
  if (!text) return [];
  return rows.filter((row) => {
    const base = baseName(row.filename);
    return base.length >= 3 && text.includes(base);
  });
}
