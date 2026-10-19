import type { ReactNode } from 'react'

/** Inline error/danger alert. Padding and text size come from `className`. */
export function Alert({
  children,
  className = '',
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <p
      role="alert"
      className={`rounded-md border border-danger/40 bg-danger/10 text-danger ${className}`}
    >
      {children}
    </p>
  )
}
