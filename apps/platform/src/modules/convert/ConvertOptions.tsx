import { useI18n } from '../../lib/i18n'
import { ASYNC_THRESHOLD_BYTES, type OcrScope } from './api'
import { formatBytes } from './format'

/** Conversion options: OCR scanned pages, image extraction, figure OCR + scope. */
export function ConvertOptions({
  scanImages,
  onScanImages,
  extractImages,
  onExtractImages,
  ocrImages,
  onOcrImages,
  ocrScope,
  onOcrScope,
  file,
}: {
  scanImages: boolean
  onScanImages: (v: boolean) => void
  extractImages: boolean
  onExtractImages: (v: boolean) => void
  ocrImages: boolean
  onOcrImages: (v: boolean) => void
  ocrScope: OcrScope
  onOcrScope: (v: OcrScope) => void
  file: File | null
}) {
  const { t } = useI18n()
  return (
    <div className="mt-4 divide-y divide-line rounded-lg border border-line">
      <label
        htmlFor="scan-images"
        className="flex cursor-pointer items-start gap-3 px-4 py-3"
      >
        <input
          id="scan-images"
          type="checkbox"
          checked={scanImages}
          onChange={(e) => onScanImages(e.target.checked)}
          className="mt-1 h-4 w-4 accent-accent"
        />
        <span className="text-sm">
          <span className="block font-medium">{t('options.scanTitle')}</span>
          <span className="block text-fg-soft">
            {t('options.scanDesc')}
          </span>
          <span className="mt-1 block text-xs text-fg-soft">
            {t('options.scanEffect')}
          </span>
        </span>
      </label>
      <label
        htmlFor="extract-images"
        className="flex cursor-pointer items-start gap-3 px-4 py-3"
      >
        <input
          id="extract-images"
          type="checkbox"
          checked={extractImages}
          onChange={(e) => {
            onExtractImages(e.target.checked)
            if (!e.target.checked) onOcrImages(false)
          }}
          className="mt-1 h-4 w-4 accent-accent"
        />
        <span className="text-sm">
          <span className="block font-medium">{t('options.imgTitle')}</span>
          <span className="block text-fg-soft">
            {t('options.imgDesc')}
          </span>
          <span className="mt-1 block text-xs text-fg-soft">
            {t('options.imgEffect')}
          </span>
        </span>
      </label>
      <label
        htmlFor="ocr-images"
        className="flex cursor-pointer items-start gap-3 px-4 py-3"
      >
        <input
          id="ocr-images"
          type="checkbox"
          checked={ocrImages}
          onChange={(e) => {
            onOcrImages(e.target.checked)
            if (e.target.checked) onExtractImages(true)
          }}
          className="mt-1 h-4 w-4 accent-accent"
        />
        <span className="text-sm">
          <span className="block font-medium">{t('options.ocrTitle')}</span>
          <span className="block text-fg-soft">
            {t('options.ocrDesc')}
          </span>
          <span className="mt-1 block text-xs text-fg-soft">
            {t('options.ocrEffect')}
          </span>
          {ocrImages && file && file.size > ASYNC_THRESHOLD_BYTES && (
            <span className="mt-1 block text-xs text-warn">
              {t('options.ocrHeavyWarn', { size: formatBytes(file.size) })}
            </span>
          )}
          {ocrImages && (
            <span className="mt-2 flex flex-wrap items-center gap-4" role="radiogroup" aria-label={t('options.scopeLabel')}>
              {(['all', 'flowchart'] as const).map((s) => (
                <label key={s} className="flex cursor-pointer items-center gap-1.5 text-xs">
                  <input
                    type="radio"
                    name="ocr-scope"
                    value={s}
                    checked={ocrScope === s}
                    onChange={() => onOcrScope(s)}
                    className="h-3.5 w-3.5 accent-accent"
                  />
                  {s === 'all' ? t('options.scopeAll') : t('options.scopeFlowchart')}
                </label>
              ))}
            </span>
          )}
        </span>
      </label>
    </div>
  )
}
