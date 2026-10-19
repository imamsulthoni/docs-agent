import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from '@tanstack/react-router'
import {
  MAX_UPLOAD_BYTES,
  cancelConvertJob,
  convertPdfAsync,
  pollConvertJob,
  type ConvertJobStatus,
  type ConvertResponse,
  type OcrScope,
} from './api'
import { useI18n } from '../../lib/i18n'
import { useConfirm } from '../../components/ConfirmDialog'
import { formatBytes } from './format'

const JOB_KEY = 'docsagent:job'

interface SavedJob {
  job_id: string
  doc_id: string
  filename: string
  started_at: number
}

function loadSavedJob(): SavedJob | null {
  try {
    const raw = localStorage.getItem(JOB_KEY)
    return raw ? (JSON.parse(raw) as SavedJob) : null
  } catch {
    return null
  }
}

function saveSavedJob(job: SavedJob): void {
  try {
    localStorage.setItem(JOB_KEY, JSON.stringify(job))
  } catch {
    /* storage full/blocked — resume just won't survive a reload */
  }
}

function clearSavedJob(): void {
  try {
    localStorage.removeItem(JOB_KEY)
  } catch {
    /* nothing to clean up */
  }
}

/**
 * Upload + conversion state machine. Every conversion runs as a background
 * job (progress + cancel + reload-safe): the job id is persisted to
 * localStorage so a page reload resumes polling instead of losing the job.
 * Navigates to the result page on success. When `workspaceId` is given the
 * doc is uploaded into that workspace and the result opens under it.
 */
export function useConvert(workspaceId?: string) {
  const navigate = useNavigate()
  const { t } = useI18n()
  const confirm = useConfirm()
  const [file, setFile] = useState<File | null>(null)
  const [scanImages, setScanImages] = useState(false)
  const [extractImages, setExtractImages] = useState(true)
  const [ocrImages, setOcrImages] = useState(false)
  const [ocrScope, setOcrScope] = useState<OcrScope>('all')
  const [pending, setPending] = useState(false)
  const [progress, setProgress] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [currentJobId, setCurrentJobId] = useState<string | null>(null)
  const [cancelling, setCancelling] = useState(false)
  const [cancelled, setCancelled] = useState(false)

  function pick(f: File | undefined) {
    setError(null)
    if (!f) return
    if (!f.name.toLowerCase().endsWith('.pdf')) {
      setError(t('upload.errPdfOnly'))
      return
    }
    if (f.size > MAX_UPLOAD_BYTES) {
      setError(t('upload.errTooBig', { name: f.name, size: formatBytes(f.size) }))
      return
    }
    setFile(f)
  }

  function describeJob(s: ConvertJobStatus): string {
    if (s.status === 'queued') return t('upload.asyncQueued')
    const done = s.progress?.pages_done ?? 0
    const total = s.progress?.pages_total
    return t('upload.asyncProcessing', {
      done,
      total: total ? `/${total}` : '',
    })
  }

  function finish(result: ConvertResponse) {
    clearSavedJob()
    try {
      sessionStorage.setItem(
        `docsagent:last:${result.doc_id}`,
        JSON.stringify(result),
      )
    } catch {
      /* storage full/blocked — result page still works via fetch */
    }
    if (workspaceId) {
      void navigate({
        to: '/w/$workspaceId/d/$docId',
        params: { workspaceId, docId: result.doc_id },
      })
    } else {
      void navigate({ to: '/r/$docId', params: { docId: result.doc_id } })
    }
  }

  function failWith(err: unknown) {
    const msg = err instanceof Error ? err.message : ''
    if (msg === t('upload.cancelled')) {
      setCancelled(true)
    } else if (/expired|not found/i.test(msg)) {
      setError(t('upload.jobExpired'))
    } else {
      setError(msg || t('api.errConvertGeneric'))
    }
  }

  async function runAsync(f: File) {
    const job = await convertPdfAsync(
      f,
      scanImages,
      extractImages,
      ocrImages,
      ocrScope,
      undefined,
      undefined,
      workspaceId,
    )
    saveSavedJob({
      job_id: job.job_id,
      doc_id: job.doc_id,
      filename: f.name,
      started_at: Date.now(),
    })
    setCurrentJobId(job.job_id)
    try {
      const result = await pollConvertJob(job.job_id, {
        workspaceId,
        onUpdate: (s) => setProgress(describeJob(s)),
      })
      finish(result)
    } catch (err) {
      clearSavedJob()
      throw err
    }
  }

  async function onCancel() {
    if (!currentJobId || cancelling) return
    const ok = await confirm({
      title: t('upload.cancelConfirm'),
      confirmLabel: t('upload.cancel'),
    })
    if (!ok) return
    setCancelling(true)
    try {
      await cancelConvertJob(currentJobId)
      clearSavedJob()
      setCancelled(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('api.errConvertGeneric'))
    } finally {
      setCancelling(false)
      setCurrentJobId(null)
      setPending(false)
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setProgress(null)
    setCancelled(false)
    if (!file) {
      setError(t('upload.errNoFile'))
      return
    }
    setPending(true)
    try {
      await runAsync(file)
    } catch (err) {
      failWith(err)
    } finally {
      setPending(false)
      setProgress(null)
    }
  }

  // Resume an in-flight background job after a reload: the converter keeps
  // processing, and the job id persisted in localStorage lets us re-poll.
  useEffect(() => {
    const saved = loadSavedJob()
    if (!saved) return
    const ac = new AbortController()
    let active = true
    setPending(true)
    setCurrentJobId(saved.job_id)
    setProgress(t('upload.resumed'))
    pollConvertJob(saved.job_id, {
      signal: ac.signal,
      workspaceId,
      onUpdate: (s) => {
        if (active) setProgress(describeJob(s))
      },
    })
      .then((result) => {
        if (active) finish(result)
      })
      .catch((err) => {
        if (active) {
          clearSavedJob()
          failWith(err)
        }
      })
      .finally(() => {
        if (active) {
          setPending(false)
          setProgress(null)
          setCurrentJobId(null)
        }
      })
    return () => {
      active = false
      ac.abort()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return {
    file,
    scanImages,
    setScanImages,
    extractImages,
    setExtractImages,
    ocrImages,
    setOcrImages,
    ocrScope,
    setOcrScope,
    pending,
    progress,
    error,
    currentJobId,
    cancelling,
    cancelled,
    pick,
    onSubmit,
    onCancel,
  }
}
