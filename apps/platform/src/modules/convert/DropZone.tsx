import { useState } from 'react'
import { useI18n } from '../../lib/i18n'
import { UploadIcon } from '../../components/icons'
import { formatBytes } from './format'

/** PDF drop target: click to browse, drag & drop, or keyboard-activate. */
export function DropZone({
  file,
  onPick,
}: {
  file: File | null
  onPick: (f: File | undefined) => void
}) {
  const { t } = useI18n()
  const [dragging, setDragging] = useState(false)
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={t('upload.dropAria')}
      onClick={() => document.getElementById('pdf-file')?.click()}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          document.getElementById('pdf-file')?.click()
        }
      }}
      onDragOver={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        onPick(e.dataTransfer.files?.[0])
      }}
      className={`flex min-h-48 cursor-pointer flex-col items-start justify-between rounded-lg border border-dashed p-6 transition-colors ${
        dragging
          ? 'border-accent bg-accent/5'
          : file
            ? 'border-line-strong bg-surface'
            : 'border-line-strong hover:border-fg-soft hover:bg-surface'
      }`}
    >
      <UploadIcon
        className={`h-6 w-6 ${file ? 'text-accent-text' : 'text-fg-soft'}`}
      />
      {file ? (
        <span>
          <span className="block break-all text-lg font-medium">{file.name}</span>
          <span className="mt-1 block font-mono text-xs text-fg-soft">
            {formatBytes(file.size)} &middot; {t('upload.fileReplace')}
          </span>
        </span>
      ) : (
        <span>
          <span className="block text-lg font-medium">
            {t('upload.dropTitle')}{' '}
            <span className="underline decoration-accent underline-offset-4">
              {t('upload.browse')}
            </span>
          </span>
          <span className="mt-1 block font-mono text-xs text-fg-soft">
            {t('upload.dropHint')}
          </span>
        </span>
      )}
      <input
        id="pdf-file"
        type="file"
        accept="application/pdf,.pdf"
        className="sr-only"
        tabIndex={-1}
        onChange={(e) => onPick(e.target.files?.[0] ?? undefined)}
      />
    </div>
  )
}
