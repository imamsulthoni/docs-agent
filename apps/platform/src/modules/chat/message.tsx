import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link } from '@tanstack/react-router'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { UIMessage } from '@anvia/react'
import { Message, useMessage, useMessagePart } from '@anvia/react-ui'
import { useI18n } from '../../lib/i18n'
import { CheckIcon, CopyIcon, FileIcon, WrenchIcon } from '../../components/icons'
import { chatMarkdownComponents } from './markdown'
import { jsonText } from './protocol'
import { formatAttachmentSize } from './attachments'

const chip =
  'inline-flex max-w-[14rem] items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium'

/** Mention chip persisted server-side with the user message. */
export type UiMention = {
  docId: string
  documentName: string
  workspaceId: string | null
  deleted: boolean
}

/** Attachment chip persisted server-side with the user message. */
export type UiAttachment = {
  id: string
  filename: string
  mimeType: string
  sizeBytes: number
  truncated: boolean
  deleted: boolean
}

/**
 * File chips for past user messages. A chip that was soft-deleted keeps its
 * snapshot name and renders struck-through, matching the mention pattern.
 */
export function MessageAttachments() {
  const { message } = useMessage()
  const { t } = useI18n()
  const items =
    (message.metadata as { attachments?: UiAttachment[] } | undefined)?.attachments ??
    []
  if (items.length === 0) return null

  return (
    <div className="mb-1.5 flex flex-wrap gap-1.5">
      {items.map((a) => (
        <span
          key={a.id}
          className={`${chip} ${
            a.deleted
              ? 'border-line bg-surface-2 text-fg-faint line-through'
              : 'border-line bg-surface text-fg-soft'
          }`}
          title={a.filename}
        >
          <FileIcon className="shrink-0" />
          <span className="truncate">{a.filename}</span>
          <span className="shrink-0 font-mono text-fg-faint">
            {formatAttachmentSize(a.sizeBytes)}
          </span>
          {a.deleted ? (
            <span className="shrink-0 no-underline">
              · {t('chat.attachChipDeleted')}
            </span>
          ) : a.truncated ? (
            <span className="shrink-0 no-underline text-fg-faint">
              · {t('chat.attachChipTruncated')}
            </span>
          ) : null}
        </span>
      ))}
    </div>
  )
}

/**
 * `@` chips for the current user message. A document that has since been
 * deleted keeps its snapshot name and renders as a non-clickable "deleted"
 * chip, matching the BRD requirement.
 */
export function MessageMentions() {
  const { message } = useMessage()
  const { t } = useI18n()
  const mentions =
    (message.metadata as { mentions?: UiMention[] } | undefined)?.mentions ?? []
  if (mentions.length === 0) return null

  return (
    <div className="mb-1.5 flex flex-wrap gap-1.5">
      {mentions.map((m) =>
        m.deleted ? (
          <span
            key={m.docId}
            className={`${chip} border-line bg-surface-2 text-fg-faint line-through`}
            title={t('chat.mentionDeleted')}
          >
            <span className="truncate">@{m.documentName}</span>
            <span className="shrink-0 no-underline">
              · {t('chat.mentionDeleted')}
            </span>
          </span>
        ) : m.workspaceId ? (
          <Link
            key={m.docId}
            to="/w/$workspaceId/d/$docId"
            params={{ workspaceId: m.workspaceId, docId: m.docId }}
            className={`${chip} border-line bg-surface text-fg-soft transition-colors hover:border-line-strong hover:text-fg`}
            title={m.documentName}
          >
            <span className="truncate">@{m.documentName}</span>
          </Link>
        ) : (
          <span key={m.docId} className={`${chip} border-line bg-surface text-fg-soft`}>
            <span className="truncate">@{m.documentName}</span>
          </span>
        ),
      )}
    </div>
  )
}

import {
  formatContextTokens,
  formatCostUsd,
  formatPerMPrice,
  formatTokens,
} from './usage'

/** Token/cost footer under one assistant message (metadata from message_end). */
export function MessageUsage() {
  const { message } = useMessage()
  if (message.role !== 'assistant') return null
  const meta = message.metadata as
    | {
        usage?: { inputTokens?: number; outputTokens?: number }
      }
    | undefined
  const input =
    typeof meta?.usage?.inputTokens === 'number' ? meta.usage.inputTokens : 0
  const output =
    typeof meta?.usage?.outputTokens === 'number' ? meta.usage.outputTokens : 0
  if (input === 0 && output === 0) return null
  return (
    <p className="mt-1.5 font-mono text-[11px] text-fg-faint">
      {formatTokens(input)} in / {formatTokens(output)} out
    </p>
  )
}

/** Session total cost badge (accumulated by DocChat from stream metadata). */
export function SessionCostBadge({
  totalTokens,
  costUsd,
}: {
  totalTokens: number
  costUsd: number
}) {
  const { t } = useI18n()
  if (totalTokens <= 0) return null
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border border-line bg-surface px-2 py-0.5 font-mono text-[11px] text-fg-soft"
      title={t('chat.sessionTokens', { total: formatTokens(totalTokens) })}
    >
      Σ {formatTokens(totalTokens)} · {formatCostUsd(costUsd)}
    </span>
  )
}

/** One model option in the picker: name plus its pricing/service metadata. */
export type PickerOption = {
  id: string
  label: string
  promptPerM?: number
  completionPerM?: number
  reasoning?: boolean
  contextWindow?: number
  free?: boolean
}

/** Per-session chat model picker (custom dropdown, mirrors session select). */
export function ModelPicker({
  options,
  value,
  onChange,
  disabled,
}: {
  options: PickerOption[]
  value: string | null
  onChange: (id: string | null) => void
  disabled: boolean
}) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0, width: 256 })
  const btnRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const active = options.find((o) => o.id === value) ?? null

  function optionTitle(m: PickerOption): string {
    const parts: string[] = []
    if (
      typeof m.promptPerM === 'number' &&
      typeof m.completionPerM === 'number' &&
      (m.promptPerM > 0 || m.completionPerM > 0 || m.free)
    ) {
      parts.push(
        t('chat.modelPrice', {
          input: formatPerMPrice(m.promptPerM),
          output: formatPerMPrice(m.completionPerM),
        }),
      )
    }
    if (m.contextWindow && m.contextWindow > 0) {
      parts.push(t('chat.modelCtx', { ctx: formatContextTokens(m.contextWindow) }))
    }
    parts.push(m.id)
    return parts.join(' · ')
  }

  // Portal the menu to <body> so no overflow-hidden ancestor can clip it.
  // Re-anchor on open/resize/scroll (capture) so it tracks the button.
  useLayoutEffect(() => {
    if (!open) return
    function anchor() {
      const r = btnRef.current?.getBoundingClientRect()
      if (!r) return
      const width = Math.max(256, Math.min(320, r.width + 64))
      setMenuPos({
        top: r.bottom + 4,
        // Open rightward: align menu's left edge with the button.
        left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)),
        width,
      })
    }
    anchor()
    window.addEventListener('resize', anchor)
    window.addEventListener('scroll', anchor, true)
    return () => {
      window.removeEventListener('resize', anchor)
      window.removeEventListener('scroll', anchor, true)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    function onPointerDown(e: PointerEvent) {
      if (
        btnRef.current &&
        !btnRef.current.contains(e.target as Node) &&
        menuRef.current &&
        !menuRef.current.contains(e.target as Node)
      )
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

  function choose(id: string | null) {
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
    <div className="min-w-0">
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
        disabled={disabled || options.length === 0}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('chat.modelPicker')}
        title={active ? optionTitle(active) : undefined}
        className="flex max-w-56 items-center justify-between gap-2 rounded-md border border-line bg-bg px-2.5 py-1.5 text-xs transition-colors hover:border-line-strong disabled:opacity-50"
      >
        <span className="truncate text-fg">
          {active
            ? `${active.label}${active.free ? ` · ${t('chat.modelFree')}` : ''}`
            : t('chat.modelDefault')}
        </span>
        <span
          aria-hidden
          className={`shrink-0 text-fg-faint transition-transform ${open ? 'rotate-180' : ''}`}
        >
          ▾
        </span>
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            aria-label={t('chat.modelPicker')}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                moveFocus(1)
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                moveFocus(-1)
              }
            }}
            className="fixed z-[100] max-h-64 overflow-y-auto rounded-md border border-line-strong bg-surface py-1 shadow-lg"
            style={{
              top: menuPos.top,
              left: menuPos.left,
              width: menuPos.width,
            }}
          >
            <button
              type="button"
              role="menuitemradio"
              aria-checked={value === null}
              onClick={() => choose(null)}
              className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-surface-2 ${
                value === null ? 'text-fg' : 'text-fg-soft'
              }`}
            >
              <span className="truncate">{t('chat.modelDefault')}</span>
              {value === null && <CheckIcon />}
            </button>
            {options.map((m) => (
              <button
                key={m.id}
                type="button"
              role="menuitemradio"
              aria-checked={m.id === value}
              onClick={() => choose(m.id)}
              title={optionTitle(m)}
              className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-surface-2 ${
                m.id === value ? 'text-fg' : 'text-fg-soft'
              }`}
            >
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="truncate text-fg">{m.label}</span>
                  {m.free && (
                    <span className="shrink-0 rounded-full border border-line bg-surface-2 px-1.5 py-px text-[10px] font-medium text-fg-soft">
                      {t('chat.modelFree')}
                    </span>
                  )}
                  {m.reasoning && (
                    <span className="shrink-0 rounded-full border border-accent/40 bg-accent/10 px-1.5 py-px text-[10px] font-medium text-accent-text">
                      {t('chat.modelThinking')}
                    </span>
                  )}
                </span>
                {typeof m.promptPerM === 'number' &&
                  typeof m.completionPerM === 'number' &&
                  (m.promptPerM > 0 || m.completionPerM > 0 || m.free) && (
                    <span className="truncate font-mono text-[10px] text-fg-faint">
                      {t('chat.modelPrice', {
                        input: formatPerMPrice(m.promptPerM),
                        output: formatPerMPrice(m.completionPerM),
                      })}
                      {m.contextWindow && m.contextWindow > 0
                        ? ` · ${t('chat.modelCtx', {
                            ctx: formatContextTokens(m.contextWindow),
                          })}`
                        : ''}
                    </span>
                  )}
              </span>
              {m.id === value && <CheckIcon />}
            </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  )
}

/** One tool call, rendered inline inside its assistant message. */
function ToolCall() {
  const { part } = useMessagePart()
  const { t } = useI18n()
  if (part.type !== 'tool') return null
  const running =
    part.state === 'input-streaming' || part.state === 'input-available'
  const failed = part.state === 'error'
  const hasDetail =
    part.input !== undefined ||
    part.output !== undefined ||
    part.error !== undefined

  return (
    <details className="my-1.5 overflow-hidden rounded-md border border-line bg-bg text-xs">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-2.5 py-1.5 font-mono text-[11px] text-fg-soft">
        <WrenchIcon
          className={`shrink-0 ${failed ? 'text-danger' : 'text-accent-text'}`}
        />
        <span className="truncate font-medium text-fg">{part.toolName}</span>
        {running ? (
          <span className="inline-flex shrink-0 items-center gap-1.5">
            <span
              aria-hidden
              className="h-3 w-3 animate-spin rounded-full border-2 border-line-strong border-t-accent"
            />
            {t('chat.running')}
          </span>
        ) : (
          <span className={`shrink-0 ${failed ? 'text-danger' : ''}`}>
            {failed ? t('chat.toolError') : t('chat.done')}
          </span>
        )}
      </summary>
      {hasDetail && (
        <div className="space-y-2 border-t border-line px-2.5 py-2">
          {part.input !== undefined && (
            <div>
              <p className="label mb-1">{t('chat.input')}</p>
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px]">
                {jsonText(part.input)}
              </pre>
            </div>
          )}
          {part.output !== undefined && (
            <div>
              <p className="label mb-1">{t('chat.output')}</p>
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px]">
                {jsonText(part.output)}
              </pre>
            </div>
          )}
          {part.error !== undefined && (
            <p role="alert" className="text-danger">
              {part.error.message}
            </p>
          )}
        </div>
      )}
    </details>
  )
}

/** Renders the current message part (text, reasoning or tool call). */
export function MessagePart({
  role,
  smoothedText,
  firstTextId,
}: {
  role: UIMessage['role']
  /** Joined animated text for the streaming message (only at its first text part). */
  smoothedText?: string
  firstTextId?: string
}) {
  const { part } = useMessagePart()
  const { t } = useI18n()

  if (part.type === 'text') {
    if (smoothedText !== undefined) {
      if (part.id !== firstTextId) return null
      return (
        <div className="chat-md">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={chatMarkdownComponents}
          >
            {smoothedText}
          </ReactMarkdown>
        </div>
      )
    }
    return role === 'user' ? (
      <span className="whitespace-pre-wrap">
        <Message.Text />
      </span>
    ) : (
      <div className="chat-md">
        <Message.Markdown
          remarkPlugins={[remarkGfm]}
          components={chatMarkdownComponents}
        />
      </div>
    )
  }

  if (part.type === 'reasoning') {
    return (
      <details className="my-2 rounded-md border border-line bg-bg px-3 py-2 text-xs text-fg-soft">
        <summary className="cursor-pointer select-none font-medium text-fg">
          {t('chat.thinking')}
        </summary>
        <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap font-sans">
          {part.text}
        </pre>
      </details>
    )
  }

  if (part.type === 'tool') return <ToolCall />

  return null
}

export function CopyMessage() {
  const { message } = useMessage()
  const [copied, setCopied] = useState(false)
  const { t } = useI18n()
  async function copy() {
    const text = message.parts
      .flatMap((part) => (part.type === 'text' ? [part.text] : []))
      .join('\n')
    await navigator.clipboard.writeText(text)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }
  return (
    <button
      type="button"
      onClick={() => void copy()}
      aria-label={copied ? t('chat.copied') : t('chat.copyAnswer')}
      title={copied ? t('chat.copied') : t('chat.copyAnswer')}
      className="text-fg-faint opacity-0 transition-opacity hover:text-fg focus-visible:opacity-100 group-hover:opacity-100"
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
    </button>
  )
}
