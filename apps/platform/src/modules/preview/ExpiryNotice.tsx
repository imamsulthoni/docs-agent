import { useEffect, useState } from 'react'
import { localeTag, t, useI18n } from '../../lib/i18n'

function formatRemaining(expiresAt: string, now: number): string {
  const ms = new Date(expiresAt).getTime() - now
  if (Number.isNaN(ms)) return ''
  if (ms <= 0) return t('result.remainNow')
  const mins = Math.round(ms / 60000)
  if (mins < 1) return t('result.remainSoon')
  if (mins < 60) return t('result.remainMin', { mins })
  return t('result.remainHM', { h: Math.floor(mins / 60), m: mins % 60 })
}

/** Warns that the doc + sessions + vectors auto-delete. */
export function ExpiryNotice({ expiresAt }: { expiresAt: string | null }) {
  const { t } = useI18n()
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!expiresAt) return
    const t = window.setInterval(() => setNow(Date.now()), 30000)
    return () => window.clearInterval(t)
  }, [expiresAt])

  const when = expiresAt ? new Date(expiresAt) : null
  const valid = when !== null && !Number.isNaN(when.getTime())
  return (
    <p
      role="note"
      className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-l-2 border-warn bg-warn/10 px-4 py-2.5 text-sm"
    >
      <span className="font-medium">
        {t('result.autoDelete')}{' '}
        {valid && expiresAt
          ? t('result.autoDeleteAt', { time: when.toLocaleTimeString(localeTag()), remain: formatRemaining(expiresAt, now) })
          : t('result.autoDeleteDefault')}
      </span>
      <span className="text-fg-soft">
        {t('result.autoDeleteNote')}
      </span>
    </p>
  )
}
