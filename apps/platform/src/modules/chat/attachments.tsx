import { useCallback, useEffect, useRef, useState } from 'react'
import { useI18n } from '../../lib/i18n'
import {
  MAX_ATTACHMENTS_PER_MESSAGE,
  MAX_ATTACHMENT_MB,
  AttachmentUploadError,
  deleteAttachmentApi,
  pollAttachment,
  uploadAttachment,
} from './api'
import { FileIcon, XIcon } from '../../components/icons'

/** One attachment chip above the composer while it is being prepared. */
export interface TrayItem {
  key: string
  name: string
  size: number
  status: 'uploading' | 'processing' | 'ready' | 'failed'
  /** Server row id — set once the upload POST resolved. */
  id?: string
  truncated?: boolean
  error?: string
}

/** Rejected-file feedback (no toasts in this app — inline notice row). */
export interface TrayNotice {
  kind: 'invalid_type' | 'too_large' | 'too_many'
  name?: string
}

const ACCEPTED_EXT = /\.(pdf|png|jpe?g|webp|txt|md|markdown)$/i
const POLL_MAX_MS = 3 * 60 * 1000

export function formatAttachmentSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

/**
 * Client-side mirror of the server's `attachments` state machine:
 * upload → (processing | ready | failed), with polling driven by the caller.
 */
export function useAttachmentTray(docId: string, sessionId: string) {
  const [items, setItems] = useState<TrayItem[]>([])
  const [notice, setNotice] = useState<TrayNotice | null>(null)
  // Guards a submit racing a still-processing chip: refs stay current
  // across renders without re-binding the composer callback.
  const itemsRef = useRef<TrayItem[]>([])
  itemsRef.current = items
  const abortsRef = useRef(new Map<string, AbortController>())
  const seq = useRef(0)

  const patch = useCallback((key: string, next: Partial<TrayItem>) => {
    setItems((prev) =>
      prev.map((it) => (it.key === key ? { ...it, ...next } : it)),
    )
  }, [])

  const drop = useCallback((key: string) => {
    setItems((prev) => prev.filter((it) => it.key !== key))
  }, [])

  const track = useCallback(
    (key: string, id: string) => {
      const abort = new AbortController()
      abortsRef.current.set(key, abort)
      void Promise.race([
        pollAttachment(
          docId,
          id,
          (row) => {
            if (row.status === 'processing') return false
            patch(key, {
              status: row.status === 'ready' ? 'ready' : 'failed',
              truncated: row.truncated || undefined,
              error: row.error ?? undefined,
            })
            return true
          },
          abort.signal,
        ),
        // Converter stalls are rare but real: stop spinning eventually.
        new Promise((resolve) => setTimeout(resolve, POLL_MAX_MS)).then(() => {
          patch(key, { status: 'failed', error: 'status_timeout' })
        }),
      ])
        .catch(() => {
          if (!abort.signal.aborted) {
            patch(key, { status: 'failed', error: 'status_failed' })
          }
        })
        .finally(() => abortsRef.current.delete(key))
    },
    [docId, patch],
  )

  const addFiles = useCallback(
    (files: File[]) => {
      setNotice(null)
      const accepted: File[] = []
      for (const file of files) {
        if (!ACCEPTED_EXT.test(file.name)) {
          setNotice({ kind: 'invalid_type', name: file.name })
          continue
        }
        if (file.size > MAX_ATTACHMENT_MB * 1024 * 1024) {
          setNotice({ kind: 'too_large', name: file.name })
          continue
        }
        accepted.push(file)
      }
      setItems((prev) => {
        const room = MAX_ATTACHMENTS_PER_MESSAGE - prev.length
        if (accepted.length > room) {
          setNotice({ kind: 'too_many' })
        }
        const take = accepted.slice(0, Math.max(0, room))
        const fresh = take.map<TrayItem>((file) => ({
          key: `f${++seq.current}`,
          name: file.name,
          size: file.size,
          status: 'uploading',
        }))
        for (const [i, file] of take.entries()) {
          const key = fresh[i].key
          void uploadAttachment(docId, file, sessionId)
            .then((row) => {
              patch(key, { id: row.id, status: 'processing' })
              track(key, row.id)
            })
            .catch((err: unknown) => {
              const detail =
                err instanceof AttachmentUploadError ? `http:${err.httpStatus}` : 'upload_failed'
              patch(key, { status: 'failed', error: detail })
            })
        }
        return take.length > 0 ? [...prev, ...fresh] : prev
      })
    },
    [docId, sessionId, track, patch],
  )

  const remove = useCallback(
    (key: string) => {
      const item = itemsRef.current.find((it) => it.key === key)
      abortsRef.current.get(key)?.abort()
      abortsRef.current.delete(key)
      drop(key)
      // Only rows that reached the server need the soft-delete call.
      if (item?.id) void deleteAttachmentApi(docId, item.id)
    },
    [docId, drop],
  )

  const clearSent = useCallback(() => {
    for (const abort of abortsRef.current.values()) abort.abort()
    abortsRef.current.clear()
    setItems([])
    setNotice(null)
  }, [])

  useEffect(() => () => {
    for (const abort of abortsRef.current.values()) abort.abort()
  }, [])

  const busy = items.some((it) => it.status === 'uploading' || it.status === 'processing')
  const readyIds = items
    .filter((it) => it.status === 'ready' && it.id)
    .map((it) => it.id as string)

  return { items, notice, setNotice, busy, readyIds, addFiles, remove, clearSent }
}

/** Chips row shown between the composer and the message list. */
export function AttachmentTray({
  items,
  notice,
  onDismissNotice,
  onRemove,
}: {
  items: TrayItem[]
  notice: TrayNotice | null
  onDismissNotice: () => void
  onRemove: (key: string) => void
}) {
  const { t } = useI18n()
  if (items.length === 0 && !notice) return null

  return (
    <div className="shrink-0 space-y-1.5">
      {notice && (
        <p role="alert" className="flex items-center gap-2 text-xs text-danger">
          {notice.kind === 'too_many'
            ? t('chat.attachErrTooMany', { n: MAX_ATTACHMENTS_PER_MESSAGE })
            : notice.kind === 'too_large'
              ? t('chat.attachErrTooLarge', { name: notice.name ?? '' })
              : t('chat.attachErrType', { name: notice.name ?? '' })}
          <button
            type="button"
            aria-label={t('chat.attachDismiss')}
            onClick={onDismissNotice}
            className="text-fg-faint hover:text-fg"
          >
            <XIcon />
          </button>
        </p>
      )}
      {items.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {items.map((it) => (
            <span
              key={it.key}
              className={`inline-flex max-w-[16rem] items-center gap-1.5 rounded-md border px-2 py-1 text-xs ${
                it.status === 'failed'
                  ? 'border-danger/50 bg-danger/10 text-fg'
                  : 'border-line bg-surface text-fg-soft'
              }`}
              title={it.error ? t('chat.attachErrStatus') : it.name}
            >
              <FileIcon className="shrink-0 text-fg-faint" />
              <span className="truncate font-medium text-fg">{it.name}</span>
              <span className="shrink-0 text-fg-faint">
                {formatAttachmentSize(it.size)}
              </span>
              {it.status === 'uploading' || it.status === 'processing' ? (
                <span
                  aria-hidden
                  className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-line-strong border-t-accent"
                />
              ) : it.status === 'failed' ? (
                <span className="shrink-0 text-danger">{t('chat.attachFailed')}</span>
              ) : it.truncated ? (
                <span className="shrink-0 text-fg-faint">{t('chat.attachTruncated')}</span>
              ) : (
                <span className="shrink-0 text-accent-text">{t('chat.attachReady')}</span>
              )}
              <button
                type="button"
                aria-label={`${t('chat.attachRemove')} ${it.name}`}
                onClick={() => onRemove(it.key)}
                className="shrink-0 text-fg-faint transition-colors hover:text-fg"
              >
                <XIcon />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * Drop target + paste catcher around the composer. Files arrive via
 * dataTransfer/clipboard `files` (drag & drop and Ctrl+V of copied files);
 * pasted screenshots surface as image files the same way.
 */
export function AttachmentDropzone({
  enabled,
  onFiles,
  children,
}: {
  enabled: boolean
  onFiles: (files: File[]) => void
  children: React.ReactNode
}) {
  const { t } = useI18n()
  const [dragging, setDragging] = useState(false)
  const depth = useRef(0)

  if (!enabled) return <>{children}</>

  return (
    <div
      className={`relative rounded-lg transition-shadow ${
        dragging ? 'ring-2 ring-accent' : ''
      }`}
      data-dragging={dragging || undefined}
      onDragEnter={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return
        depth.current += 1
        e.preventDefault()
        setDragging(true)
      }}
      onDragOver={(e) => {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
      }}
      onDragLeave={() => {
        depth.current -= 1
        if (depth.current <= 0) {
          depth.current = 0
          setDragging(false)
        }
      }}
      onDrop={(e) => {
        e.preventDefault()
        depth.current = 0
        setDragging(false)
        const files = Array.from(e.dataTransfer.files)
        if (files.length > 0) onFiles(files)
      }}
      onPaste={(e) => {
        const files = Array.from(e.clipboardData.files)
        if (files.length > 0) {
          e.preventDefault()
          onFiles(files)
        }
      }}
    >
      {children}
      {dragging && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-bg/80 text-sm font-medium text-accent"
        >
          {t('chat.attachDropHere')}
        </div>
      )}
    </div>
  )
}
