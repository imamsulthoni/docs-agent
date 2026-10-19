import { useI18n } from '../lib/i18n'

/** Segmented language switch; the header supplies the surrounding container. */
export function LangSwitch() {
  const { lang, setLang, t } = useI18n()
  return (
    <div role="group" aria-label={t('lang.label')} className="flex items-center">
      {(['id', 'en'] as const).map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => setLang(l)}
          aria-pressed={lang === l}
          title={l === 'id' ? t('lang.id') : t('lang.en')}
          className={`rounded px-2 py-1 text-[11px] font-semibold uppercase transition-colors ${
            lang === l
              ? 'bg-surface-2 text-fg'
              : 'text-fg-faint hover:text-fg'
          }`}
        >
          {l}
        </button>
      ))}
    </div>
  )
}
