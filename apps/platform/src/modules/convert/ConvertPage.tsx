import { useI18n, type StringKey } from '../../lib/i18n'
import { Alert } from '../../components/ui/Alert'
import { Button } from '../../components/ui/Button'
import { Spinner } from '../../components/ui/Spinner'
import { DropZone } from './DropZone'
import { ConvertOptions } from './ConvertOptions'
import { useConvert } from './useConvert'
import { LibraryPanel } from '../library/LibraryPanel'

export function ConvertPage() {
  const { t } = useI18n()
  const c = useConvert()

  const roadmapSoon = t('upload.roadmapSoon')
  const roadmap = [t('upload.roadmapBrd'), t('upload.roadmapQA')]

  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
      {/* Hero — typography card */}
      <section
        aria-labelledby="upload-heading"
        className="rounded-lg border border-line bg-surface p-6 sm:p-8 lg:col-span-7"
      >
        <h1
          id="upload-heading"
          className="text-4xl font-semibold leading-[1.05] tracking-[-0.035em] sm:text-6xl"
        >
          {t('upload.titleA')}
          <br />
          <span className="text-fg-soft">{t('upload.titleB')}</span>
        </h1>
        <p className="mt-5 max-w-md text-fg-soft">
          {t('upload.subtitle')}
        </p>
        <div className="mt-8">
          <p className="label">{t('upload.roadmapLabel')}</p>
          <ul className="mt-3 flex flex-col gap-2">
            {roadmap.map((item) => (
              <li key={item} className="flex items-center gap-2.5 text-sm">
                <span aria-hidden className="h-1 w-1 shrink-0 rounded-full bg-accent" />
                <span className="text-fg-soft">{item}</span>
                <span className="rounded-sm border border-line px-1.5 py-0.5 font-mono text-[0.625rem] uppercase tracking-[0.08em] text-fg-faint">
                  {roadmapSoon}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Guest upload — primary CTA card */}
      <form
        onSubmit={c.onSubmit}
        className="rounded-lg border border-line bg-surface p-5 sm:p-6 lg:col-span-5 lg:col-start-8 lg:row-span-2"
      >
        <p className="label">{t('upload.step')}</p>
        <div className="mt-5">
          <DropZone file={c.file} onPick={c.pick} />
          <ConvertOptions
            scanImages={c.scanImages}
            onScanImages={c.setScanImages}
            extractImages={c.extractImages}
            onExtractImages={c.setExtractImages}
            ocrImages={c.ocrImages}
            onOcrImages={c.setOcrImages}
            ocrScope={c.ocrScope}
            onOcrScope={c.setOcrScope}
            file={c.file}
          />
        </div>

        <div aria-live="polite" className="mt-4 min-h-6 text-sm">
          {c.error && <Alert className="px-3 py-2">{c.error}</Alert>}
          {c.cancelled && !c.error && (
            <p className="rounded-md border border-line bg-surface-2 px-3 py-2 text-fg-soft">
              {t('upload.cancelled')}
            </p>
          )}
          {c.pending && !c.error && (
            <div className="flex items-center justify-between gap-2">
              <p className="flex items-center gap-2 text-fg-soft">
                <Spinner className="h-4 w-4" />
                {c.progress ?? t('upload.pendingMsg')}
              </p>
              {c.currentJobId && (
                <button
                  type="button"
                  onClick={c.onCancel}
                  disabled={c.cancelling}
                  className="shrink-0 rounded-md border border-line px-3 py-1.5 text-sm text-fg-soft transition-colors hover:bg-danger/10 hover:text-danger disabled:opacity-40"
                >
                  {c.cancelling ? t('upload.cancelling') : t('upload.cancel')}
                </button>
              )}
            </div>
          )}
        </div>

        <Button
          type="submit"
          variant="accent"
          size="lg"
          disabled={c.pending || !c.file}
          aria-busy={c.pending}
          className="mt-2 w-full disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-fg-faint"
        >
          {c.pending
            ? t('upload.submitBusy')
            : c.file
              ? t('upload.submitConvert')
              : t('upload.submitIdle')}
        </Button>

        {/* Saved documents — merged into the conversion card */}
        <LibraryPanel />
      </form>

      {/* Static feature cards */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:col-span-7">
        {([
          ['feature.ragTitle', 'feature.ragDesc'],
          ['feature.mdTitle', 'feature.mdDesc'],
          ['feature.ocrTitle', 'feature.ocrDesc'],
          ['feature.mentionTitle', 'feature.mentionDesc'],
          ['feature.attachTitle', 'feature.attachDesc'],
          ['feature.expiryTitle', 'feature.expiryDesc'],
        ] as const satisfies Array<[StringKey, StringKey]>).map(([titleKey, descKey]) => (
          <div key={titleKey} className="rounded-lg border border-line bg-surface p-5">
            <p className="label">{t(titleKey)}</p>
            <p className="mt-2.5 text-sm text-fg-soft">
              {t(descKey)}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}
