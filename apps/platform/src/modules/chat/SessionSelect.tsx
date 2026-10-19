import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../../lib/i18n'
import { Button } from '../../components/ui/Button'
import { CheckIcon } from '../../components/icons'

export function SessionSelect({
  sessions,
  active,
  onChange,
  onNew,
  onDelete,
  disabled,
}: {
  sessions: string[]
  active: string
  onChange: (id: string) => void
  onNew: () => void
  onDelete: (id: string) => void
  disabled: boolean
}) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const activeIdx = sessions.indexOf(active)

  useEffect(() => {
    if (!open) return
    function onPointerDown(e: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node))
        setOpen(false)
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false)
        btnRef.current?.focus()
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  useEffect(() => {
    if (disabled) setOpen(false)
  }, [disabled])

  function choose(id: string) {
    onChange(id)
    setOpen(false)
    btnRef.current?.focus()
  }

  function moveFocus(dir: 1 | -1) {
    const items = menuRef.current?.querySelectorAll<HTMLButtonElement>(
      '[role="menuitemradio"]',
    )
    if (!items || items.length === 0) return
    const cur = Array.from(items).indexOf(
      document.activeElement as HTMLButtonElement,
    )
    const next = (cur + dir + items.length) % items.length
    items[next]?.focus()
  }

  return (
    <div className="flex shrink-0 items-center gap-2">
      <div ref={rootRef} className="relative min-w-0 flex-1">
        <button
          ref={btnRef}
          type="button"
          onClick={() => setOpen((o) => !o)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault()
              if (!open) {
                setOpen(true)
                window.setTimeout(() => moveFocus(1), 0)
              } else {
                moveFocus(e.key === 'ArrowDown' ? 1 : -1)
              }
            }
          }}
          disabled={disabled || sessions.length === 0}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={t('chat.sessionLabel')}
          className="flex w-full items-center justify-between gap-2 rounded-md border border-line bg-bg px-3 py-2 text-sm disabled:opacity-50"
        >
          <span className="truncate">
            {activeIdx >= 0
              ? t('chat.sessionName', { n: sessions.length - activeIdx })
              : '—'}
          </span>
          <span
            aria-hidden
            className={`shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
          >
            ▾
          </span>
        </button>
        {open && (
          <div
            ref={menuRef}
            role="menu"
            aria-label={t('chat.sessionLabel')}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                moveFocus(1)
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                moveFocus(-1)
              }
            }}
            className="absolute inset-x-0 top-full z-20 mt-1 max-h-56 overflow-y-auto rounded-md border border-line-strong bg-surface py-1 shadow-lg"
          >
            {sessions.map((s, i) => (
              <button
                key={s}
                type="button"
                role="menuitemradio"
                aria-checked={s === active}
                onClick={() => choose(s)}
                className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-surface-2 ${
                  s === active ? 'text-fg' : 'text-fg-soft'
                }`}
              >
                <span className="truncate">
                  {t('chat.sessionName', { n: sessions.length - i })}
                </span>
                {s === active && <CheckIcon />}
              </button>
            ))}
          </div>
        )}
      </div>
      <Button variant="ghost" size="md" onClick={onNew} disabled={disabled}>
        {t('chat.new')}
      </Button>
      <Button
        variant="danger"
        size="md"
        onClick={() => onDelete(active)}
        disabled={disabled}
      >
        {t('chat.delete')}
      </Button>
    </div>
  )
}
