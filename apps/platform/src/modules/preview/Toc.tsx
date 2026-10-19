import { useEffect, useRef, useState, type RefObject } from 'react'
import { useI18n } from '../../lib/i18n'

export interface TocItem {
  id: string
  level: number
  text: string
}

/**
 * "On this page" outline. Tracks the section at the top of the document
 * scroll container (not the window) and scrolls that container on click.
 */
export function Toc({
  items,
  containerRef,
}: {
  items: TocItem[]
  containerRef: RefObject<HTMLDivElement | null>
}) {
  const [active, setActive] = useState('')
  const listRef = useRef<HTMLUListElement>(null)
  const { t } = useI18n()

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    let frame = 0
    function update() {
      frame = 0
      const top = container!.getBoundingClientRect().top
      let current = items[0]?.id ?? ''
      for (const item of items) {
        const el = document.getElementById(item.id)
        if (!el) continue
        if (el.getBoundingClientRect().top - top <= 24) current = item.id
        else break
      }
      setActive(current)
    }
    function onScroll() {
      if (!frame) frame = window.requestAnimationFrame(update)
    }
    update()
    container.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      container.removeEventListener('scroll', onScroll)
      if (frame) window.cancelAnimationFrame(frame)
    }
  }, [items, containerRef])

  useEffect(() => {
    const link = listRef.current?.querySelector<HTMLElement>('[aria-current]')
    link?.scrollIntoView({ block: 'nearest' })
  }, [active])

  function go(id: string) {
    const container = containerRef.current
    const el = document.getElementById(id)
    if (!container || !el) return
    const top =
      el.getBoundingClientRect().top -
      container.getBoundingClientRect().top +
      container.scrollTop -
      16
    container.scrollTo({
      top,
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'auto'
        : 'smooth',
    })
  }

  const base = Math.min(...items.map((i) => i.level))

  return (
    <nav aria-label={t('toc.title')}>
      <p className="label mb-2">{t('toc.title')}</p>
      <ul ref={listRef} className="relative border-l border-line">
        {items.map((item, i) => (
          <li key={`${item.id}-${i}`}>
            <a
              href={`#${item.id}`}
              aria-current={active === item.id ? 'location' : undefined}
              title={item.text}
              onClick={(e) => {
                e.preventDefault()
                go(item.id)
              }}
              style={{ paddingLeft: `${0.5 + (item.level - base) * 0.5}rem` }}
              className={`-ml-px block truncate border-l py-0.5 pr-2 text-xs leading-relaxed transition-colors ${
                active === item.id
                  ? 'border-accent text-fg'
                  : 'border-transparent text-fg-soft hover:text-fg'
              }`}
            >
              {item.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  )
}
