import { useTheme } from '../lib/theme'
import { useI18n } from '../lib/i18n'
import { MoonIcon, SunIcon } from './icons'

export function ThemeToggle() {
  const [theme, toggle] = useTheme()
  const { t } = useI18n()
  const next = theme === 'dark' ? 'light' : 'dark'
  const label = next === 'light' ? t('theme.toLight') : t('theme.toDark')
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      title={label}
      className="flex h-7 w-7 items-center justify-center rounded text-base text-fg-soft transition-colors hover:bg-surface-2 hover:text-fg"
    >
      {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
    </button>
  )
}
