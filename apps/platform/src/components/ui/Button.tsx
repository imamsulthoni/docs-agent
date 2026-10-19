import type { ButtonHTMLAttributes } from 'react'

type Variant = 'accent' | 'outline' | 'ghost' | 'danger'
type Size = 'sm' | 'md' | 'lg'

const variantClass: Record<Variant, string> = {
  accent: 'bg-accent font-semibold text-accent-ink transition-opacity hover:opacity-90',
  outline:
    'border border-line font-medium transition-colors hover:border-line-strong hover:bg-surface disabled:opacity-40',
  ghost:
    'border border-line font-medium transition-colors hover:border-line-strong hover:bg-surface-2 disabled:opacity-40',
  danger:
    'border border-line font-medium text-danger transition-colors hover:border-danger/50 hover:bg-danger/10 disabled:opacity-40',
}

const sizeClass: Record<Size, string> = {
  sm: 'px-3 py-1.5 text-sm',
  md: 'px-3.5 py-2 text-sm',
  lg: 'px-4 py-3 text-sm',
}

export function Button({
  variant = 'outline',
  size = 'md',
  className = '',
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant
  size?: Size
}) {
  return (
    <button
      type={type}
      className={`rounded-md ${variantClass[variant]} ${sizeClass[size]} ${className}`}
      {...props}
    />
  )
}
