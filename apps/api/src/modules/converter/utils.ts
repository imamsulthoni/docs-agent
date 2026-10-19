import { MAX_UPLOAD_BYTES, MAX_UPLOAD_MB } from "../../config.js";

export type ConvertFormError = {
  ok: false;
  status: 400 | 413 | 422;
  detail: string;
};

export type ConvertUpload = {
  ok: true;
  file: File;
  upstream: FormData;
};

function checkedFlag(
  value: FormDataEntryValue | null,
  defaultWhenMissing: boolean,
): string {
  if (value === null) return String(defaultWhenMissing);
  return String(value === "true" || value === "on");
}

/** Validate an upload and rebuild the multipart body sent to the converter. */
export function parseConvertForm(form: FormData): ConvertUpload | ConvertFormError {
  const file = form.get("file");
  if (!(file instanceof File)) {
    return { ok: false, status: 422, detail: 'Field "file" is required.' };
  }
  if (!file.name.toLowerCase().endsWith(".pdf")) {
    return { ok: false, status: 400, detail: "v1 only supports PDF files." };
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return {
      ok: false,
      status: 413,
      detail: `File exceeds the ${MAX_UPLOAD_MB} MB limit.`,
    };
  }

  const ocrScopeRaw = form.get("ocr_scope");
  const webhookUrl = form.get("webhook_url")?.toString() ?? undefined;
  const upstream = new FormData();
  upstream.append("file", file, file.name);
  upstream.append("scan_images", checkedFlag(form.get("scan_images"), false));
  upstream.append(
    "extract_images",
    checkedFlag(form.get("extract_images"), true),
  );
  upstream.append("ocr_images", checkedFlag(form.get("ocr_images"), false));
  upstream.append("ocr_scope", ocrScopeRaw === "flowchart" ? "flowchart" : "all");
  if (webhookUrl) upstream.append("webhook_url", webhookUrl);
  return { ok: true, file, upstream };
}

export function passThrough(res: Response): Response {
  const headers = new Headers();
  for (const key of ["content-type", "content-length", "content-disposition"]) {
    const value = res.headers.get(key);
    if (value) headers.set(key, value);
  }
  return new Response(res.body, { status: res.status, headers });
}

export function isConverterTimeout(err: unknown): boolean {
  const code =
    (err as { cause?: { code?: string } })?.cause?.code ??
    (err as { code?: string })?.code;
  const name = err instanceof Error ? err.name : "";
  return (
    name === "TimeoutError" ||
    code === "UND_ERR_HEADERS_TIMEOUT" ||
    code === "UND_ERR_BODY_TIMEOUT"
  );
}
