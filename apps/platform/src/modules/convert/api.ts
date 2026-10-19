import { API_URL, apiFetch, errDetail } from '../../lib/api'
import { t } from '../../lib/i18n'

export const MAX_UPLOAD_BYTES = 30 * 1024 * 1024

/** Files above this go straight to background conversion (POST /v1/convert/jobs). */
export const ASYNC_THRESHOLD_BYTES = 8 * 1024 * 1024

/** Conversion endpoints: workspace-scoped when a workspaceId is given. */
function convertBase(workspaceId?: string): string {
  return workspaceId
    ? `${API_URL}/v1/workspaces/${workspaceId}/convert`
    : `${API_URL}/v1/convert`
}

export interface ImageMeta {
  page: number
  kind: string
  filename: string
  url: string
  width: number
  height: number
  size_bytes: number
  ocr_text?: string | null
  flowchart_mermaid?: string | null
}

export interface ConvertResponse {
  doc_id: string
  markdown: string
  markdown_url: string
  stats: {
    pages: number
    scanned_pages: number
    tables: number
    images_kept: number
    images_skipped: number
  }
  images: ImageMeta[]
  warnings: string[]
  expires_at: string | null
  metadata?: Record<string, string>
}

export type OcrScope = 'all' | 'flowchart'

function convertForm(
  file: File,
  scanImages: boolean,
  extractImages = true,
  ocrImages = false,
  ocrScope: OcrScope = 'all',
  webhookUrl?: string,
): FormData {
  const form = new FormData()
  form.append('file', file)
  form.append('scan_images', String(scanImages))
  form.append('extract_images', String(extractImages))
  form.append('ocr_images', String(ocrImages))
  form.append('ocr_scope', ocrScope)
  if (webhookUrl) form.append('webhook_url', webhookUrl)
  return form
}

export interface ConvertJobAccepted {
  job_id: string
  doc_id: string
  status: string
}

export interface ConvertJobStatus {
  job_id: string
  doc_id: string
  filename?: string | null
  status: 'queued' | 'processing' | 'done' | 'error' | 'cancelled'
  progress?: { pages_done: number; pages_total: number | null } | null
  result?: ConvertResponse | null
  error?: string | null
}

export async function convertPdfAsync(
  file: File,
  scanImages: boolean,
  extractImages = true,
  ocrImages = false,
  ocrScope: OcrScope = 'all',
  signal?: AbortSignal,
  webhookUrl?: string,
  workspaceId?: string,
): Promise<ConvertJobAccepted> {
  const res = await apiFetch(`${convertBase(workspaceId)}/jobs`, {
    method: 'POST',
    body: convertForm(file, scanImages, extractImages, ocrImages, ocrScope, webhookUrl),
    signal,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(
      errDetail(text, t('api.errConvert', { status: res.status })),
    )
  }
  return (await res.json()) as ConvertJobAccepted
}

export async function getConvertJob(
  jobId: string,
  signal?: AbortSignal,
  workspaceId?: string,
): Promise<ConvertJobStatus> {
  const res = await apiFetch(`${convertBase(workspaceId)}/jobs/${jobId}`, { signal })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(
      errDetail(text, t('api.errConvert', { status: res.status })),
    )
  }
  return (await res.json()) as ConvertJobStatus
}

export async function cancelConvertJob(jobId: string, workspaceId?: string): Promise<void> {
  const res = await apiFetch(`${convertBase(workspaceId)}/jobs/${jobId}`, {
    method: 'DELETE',
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(errDetail(text, t('api.errConvert', { status: res.status })))
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Poll until done/error. Resolves with the ConvertResponse on success. */
export async function pollConvertJob(
  jobId: string,
  opts?: {
    signal?: AbortSignal
    intervalMs?: number
    timeoutMs?: number
    workspaceId?: string
    onUpdate?: (s: ConvertJobStatus) => void
  },
): Promise<ConvertResponse> {
  const intervalMs = opts?.intervalMs ?? 2500
  const timeoutMs = opts?.timeoutMs ?? 30 * 60 * 1000
  const started = Date.now()
  for (;;) {
    if (opts?.signal?.aborted) throw new Error(t('api.errConvertGeneric'))
    const st = await getConvertJob(jobId, opts?.signal, opts?.workspaceId)
    opts?.onUpdate?.(st)
    if (st.status === 'done') {
      if (!st.result) throw new Error(t('api.errConvertGeneric'))
      return st.result
    }
    if (st.status === 'error') {
      throw new Error(st.error || t('api.errConvertGeneric'))
    }
    if (st.status === 'cancelled') {
      throw new Error(t('upload.cancelled'))
    }
    if (Date.now() - started > timeoutMs) {
      throw new Error(t('api.errConvertTimeout'))
    }
    await sleep(intervalMs)
  }
}
