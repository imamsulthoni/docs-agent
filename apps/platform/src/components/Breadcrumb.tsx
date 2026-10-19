import { Fragment } from 'react'
import { Link } from '@tanstack/react-router'
import type { LinkProps } from '@tanstack/react-router'
import type { ReactNode } from 'react'

export interface Crumb {
  label: ReactNode
  /** Route target; omit for the current (non-link) crumb. */
  to?: LinkProps['to']
  /** Route params (e.g. `{ workspaceId }`) when `to` has dynamic segments. */
  params?: Record<string, string | undefined>
}

/**
 * Compact breadcrumb trail. The last item is the current record and renders
 * as plain text; ancestors are links with the accent hover.
 */
export function Breadcrumb({ items, className = '' }: { items: Crumb[]; className?: string }) {
  if (items.length === 0) return null
  return (
    <nav aria-label="Breadcrumb" className={`min-w-0 ${className}`}>
      <ol className="flex min-w-0 items-center gap-1.5 text-xs">
        {items.map((item, i) => {
          const current = i === items.length - 1
          return (
            <Fragment key={i}>
              {i > 0 && (
                <li aria-hidden className="shrink-0 text-fg-faint">
                  ›
                </li>
              )}
              <li className="min-w-0">
                {current || !item.to ? (
                  <span className="block max-w-[16rem] truncate font-medium text-fg" aria-current={current ? 'page' : undefined}>
                    {item.label}
                  </span>
                ) : (
                  <Link
                    to={item.to}
                    {...(item.params ? { params: item.params } : {})}
                    className="block max-w-[14rem] truncate text-fg-soft transition-colors hover:text-accent-text"
                  >
                    {item.label}
                  </Link>
                )}
              </li>
            </Fragment>
          )
        })}
      </ol>
    </nav>
  )
}
