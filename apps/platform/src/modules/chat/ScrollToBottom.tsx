import { useThread } from '@anvia/react-ui'
import { useI18n } from '../../lib/i18n'
import { ArrowLeftIcon } from '../../components/icons'

export function ScrollToBottom() {
  const { atBottom, scrollToBottom } = useThread()
  const { t } = useI18n()
  if (atBottom) return null
  return (
    <button
      type="button"
      onClick={() => scrollToBottom('smooth')}
      aria-label={t('chat.scrollLatest')}
      className="absolute bottom-2 right-3 flex h-7 w-7 items-center justify-center rounded-full border border-line-strong bg-surface text-fg-soft shadow-sm transition-colors hover:text-fg"
    >
      <ArrowLeftIcon className="-rotate-90" />
    </button>
  )
}
