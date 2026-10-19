import { Agent, FormData as UndiciFormData, fetch as undiciFetch } from "undici";
import {
  CONVERTER_URL,
  CONVERTER_API_KEY,
  CONVERT_TIMEOUT_MS,
  ATTACH_OCR_TIMEOUT_MS,
  DOC_ID_RE,
} from "../../config.js";

const dispatcher = new Agent({
  connectTimeout: 10_000,
  headersTimeout: CONVERT_TIMEOUT_MS,
  bodyTimeout: CONVERT_TIMEOUT_MS,
});

/**
 * Image OCR is a seconds-per-image round-trip; reusing the conversion
 * dispatcher (10-minute headers/body timeouts) would let a wedged OCR call
 * hang a chat turn for minutes (BRD §6.7).
 */
const ocrDispatcher = new Agent({
  connectTimeout: 10_000,
  headersTimeout: ATTACH_OCR_TIMEOUT_MS,
  bodyTimeout: ATTACH_OCR_TIMEOUT_MS,
});

function makeHeaders(requestId?: string): Record<string, string> {
  const h: Record<string, string> = {};
  if (CONVERTER_API_KEY) h.Authorization = `Bearer ${CONVERTER_API_KEY}`;
  if (requestId) h["x-request-id"] = requestId;
  return h;
}

/**
 * undici's fetch only serializes its own FormData realm as multipart —
 * the gateway parses uploads into Node-native FormData, which it would
 * send as text/plain. Re-containerize entries (file bytes pass by reference).
 */
function toUndiciForm(form: FormData): UndiciFormData {
  const out = new UndiciFormData();
  for (const [key, value] of form.entries()) {
    out.append(key, value as string | Blob);
  }
  return out;
}

type UndiciResponse = {
  ok: boolean;
  status: number;
  statusText: string;
  json(): Promise<unknown>;
  text(): Promise<string>;
  headers: { forEach: (fn: (value: string, key: string) => void) => void };
  body: ReadableStream<Uint8Array> | null;
};

function toStandardResponse(undiciRes: UndiciResponse): Response {
  const headers = new Headers();
  undiciRes.headers.forEach((value, key) => headers.set(key, value));
  return new Response(undiciRes.body, {
    status: undiciRes.status,
    statusText: undiciRes.statusText,
    headers,
  });
}

async function fetchWithDispatcher(
  url: string,
  init: Record<string, unknown> = {},
  agent: Agent = dispatcher,
): Promise<UndiciResponse> {
  return undiciFetch(url, { ...init, dispatcher: agent }) as Promise<UndiciResponse>;
}

export interface ConverterClient {
  health(): Promise<{ reachable: boolean; version?: string }>;
  convertSync(
    form: FormData,
    signal?: AbortSignal,
    requestId?: string,
  ): Promise<Response>;
  convertAsync(
    form: FormData,
    signal?: AbortSignal,
    requestId?: string,
  ): Promise<Response>;
  /** Standalone image OCR (`POST /v1/ocr`), short timeout, own dispatcher. */
  ocrImage(
    form: FormData,
    signal?: AbortSignal,
    requestId?: string,
  ): Promise<Response>;
  getJob(jobId: string, signal?: AbortSignal): Promise<Response>;
  cancelJob(jobId: string, signal?: AbortSignal): Promise<Response>;
}

export const converterClient: ConverterClient = {
  async health() {
    try {
      const res = await fetchWithDispatcher(`${CONVERTER_URL}/v1/health`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return { reachable: false };
      const body = (await res.json().catch(() => null)) as {
        version?: string;
      } | null;
      return { reachable: true, version: body?.version };
    } catch {
      return { reachable: false };
    }
  },

  async convertSync(form, signal, requestId) {
    const res = await fetchWithDispatcher(`${CONVERTER_URL}/v1/convert`, {
      method: "POST",
      headers: makeHeaders(requestId),
      body: toUndiciForm(form),
      signal: signal ?? AbortSignal.timeout(CONVERT_TIMEOUT_MS),
    });
    return toStandardResponse(res);
  },

  async convertAsync(form, signal, requestId) {
    const res = await fetchWithDispatcher(`${CONVERTER_URL}/v1/convert/jobs`, {
      method: "POST",
      headers: makeHeaders(requestId),
      body: toUndiciForm(form),
      signal: signal ?? AbortSignal.timeout(CONVERT_TIMEOUT_MS),
    });
    return toStandardResponse(res);
  },

  async ocrImage(form, signal, requestId) {
    const res = await fetchWithDispatcher(
      `${CONVERTER_URL}/v1/ocr`,
      {
        method: "POST",
        headers: makeHeaders(requestId),
        body: toUndiciForm(form),
        signal: signal ?? AbortSignal.timeout(ATTACH_OCR_TIMEOUT_MS),
      },
      ocrDispatcher,
    );
    return toStandardResponse(res);
  },

  async getJob(jobId, signal) {
    if (!DOC_ID_RE.test(jobId)) {
      return new Response(JSON.stringify({ detail: "Invalid job id." }), {
        status: 400,
      });
    }
    const res = await fetchWithDispatcher(
      `${CONVERTER_URL}/v1/convert/jobs/${jobId}`,
      {
        headers: makeHeaders(),
        signal: signal ?? AbortSignal.timeout(15000),
      },
    );
    return toStandardResponse(res);
  },

  async cancelJob(jobId, signal) {
    if (!DOC_ID_RE.test(jobId)) {
      return new Response(JSON.stringify({ detail: "Invalid job id." }), {
        status: 400,
      });
    }
    const res = await fetchWithDispatcher(
      `${CONVERTER_URL}/v1/convert/jobs/${jobId}`,
      {
        method: "DELETE",
        headers: makeHeaders(),
        signal,
      },
    );
    return toStandardResponse(res);
  },
};