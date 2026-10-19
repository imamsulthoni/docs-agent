import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Message, useMessage, useMessagePart } from '@anvia/react-ui'
import type { UIMessage } from '@anvia/react'
import { useI18n } from '../../lib/i18n'
import { CheckIcon, CopyIcon, FileIcon, WrenchIcon } from '../../components/icons'
import { chatMarkdownComponents } from './markdown'
import { jsonText } from './protocol'
import { formatAttachmentSize } from './attachments'

const chip =
  'inline-flex max-w-[14rem] items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium'

/** Mention chip persisted server-side with the user message. */
type UiMention = {
  docId: string
  documentName: string
  workspaceId: string | null
  deleted: boolean
}

/** Attachment chip persisted server-side with the user message. */
type UiAttachment = {
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
