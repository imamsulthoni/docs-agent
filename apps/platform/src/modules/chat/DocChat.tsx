import { useMemo, useRef, useState } from 'react'
import {
  useChat,
  useSmoothStreamText,
  type EventTransport,
  type UIMessage,
} from '@anvia/react'
import {
  createHttpClientTransport,
  type ClientMetadata,
  type ClientStreamEvent,
  type ClientStreamRequest,
} from '@anvia/client'
import {
  ChatProvider,
  Composer,
  Message,
  Thread,
  useComposer,
  type ComposerTriggerDefinition,
  type ComposerTriggerItem,
  type ComposerTriggerState,
} from '@anvia/react-ui'
import '@anvia/react-ui/styles.css'
import { API_URL } from '../../lib/api'
import { useSession } from '../../lib/auth'
import { useI18n } from '../../lib/i18n'
import { fpHeader } from '../../lib/identity'
import { SendIcon, PlusIcon } from '../../components/icons'
import { Spinner } from '../../components/ui/Spinner'
import { Alert } from '../../components/ui/Alert'
import {
  clientEventToUIEvent,
  describeChatError,
  lastUserText,
  SUGGESTION_KEYS,
} from './protocol'
import {
  MAX_ATTACHMENTS_PER_MESSAGE,
  MAX_MENTIONS_PER_MESSAGE,
  fetchMentionableDocuments,
  type MentionableDocument,
} from './api'
import {
  AttachmentDropzone,
  AttachmentTray,
  useAttachmentTray,
} from './attachments'
import { MessagePart, CopyMessage, MessageMentions, MessageAttachments } from './message'
import { ScrollToBottom } from './ScrollToBottom'

/** Entity payload attached by the `@` trigger. */
type MentionEntityData = {
  docId?: string
  documentName?: string
  workspaceId?: string
  workspaceName?: string
}

function mentionData(item: ComposerTriggerItem): MentionEntityData {
  return (item.data ?? {}) as MentionEntityData
}

/**
 * The composer sits at the bottom of the chat panel, so a downward popover
 * falls off-screen. Anchor it above the caret instead and keep it inside the
 * viewport horizontally.
 */
function MentionMenu({
  children,
}: {
  children: (trigger: ComposerTriggerState) => React.ReactNode
}) {
  const composer = useComposer()
  const rect = composer.activeTrigger?.rect
  if (!rect) return null
  const spaceAbove = rect.top
  const spaceBelow = window.innerHeight - rect.bottom
  const openUp = spaceBelow < 260 && spaceAbove > spaceBelow
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - 360))

  return (
    <Composer.TriggerMenu
      className="z-50 overflow-hidden rounded-lg border border-line bg-surface shadow-xl shadow-black/20"
      style={{
        left,
        width: Math.min(352, window.innerWidth - left - 12),
        ...(openUp
          ? { top: 'auto', bottom: window.innerHeight - rect.top + 6 }
          : { top: rect.bottom + 6 }),
      }}
    >
      {children}
    </Composer.TriggerMenu>
  )
}

/**
 * Headless chat bound to one backend session (remount per session via key).
 * Tool calls stream in as parts of the assistant message (via eventToUIEvent),
 * so they render inline and persist through history reloads.
 */
export function DocChat({
  docId,
  workspaceId,
  sessionId,
  initialHistory,
  indexing,
  gone,
  signedIn = false,
}: {
  docId: string
  /** When set, `@` mentions are available (workspace documents only). */
  workspaceId?: string
  sessionId: string
  initialHistory: UIMessage[]
  indexing: boolean
  gone: boolean
  /** Signed-in documents never expire — "gone" then means deleted. */
  signedIn?: boolean
}) {
  const [input, setInput] = useState('')
  const [streamError, setStreamError] = useState<string | null>(null)
  const { t } = useI18n()
  const { data: session } = useSession()

  // Partial tool-call input per part (tool input can arrive in deltas).
  const toolInputsRef = useRef(new Map<string, string>())
  // Mentions for the request currently being sent (read by the transport).
  const mentionsRef = useRef<string[]>([])
  // Ready attachment ids for the request currently being sent.
  const attachmentsRef = useRef<string[]>([])

  // Mentions are an account feature and only reference workspace documents.
  const canMention = Boolean(session?.user) && Boolean(workspaceId)
  // Attachments are an account feature too (guests get HTTP 403 server-side).
  const canAttach = Boolean(session?.user)
  const tray = useAttachmentTray(docId, sessionId)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const triggers = useMemo<ComposerTriggerDefinition[]>(() => {
    if (!canMention) return []
    return [
      {
        id: 'documents',
        char: '@',
        items: async ({ query, entities, signal }) => {
          const already = new Set(
            entities
              .map((e) => (e.data as MentionEntityData | undefined)?.docId)
              .filter((id): id is string => Boolean(id)),
          )
          const remaining = MAX_MENTIONS_PER_MESSAGE - already.size
          if (remaining <= 0) return []
          const docs = await fetchMentionableDocuments(query, docId, signal)
          return docs
            .filter((d: MentionableDocument) => !already.has(d.doc_id))
            .slice(0, remaining)
            .map<ComposerTriggerItem>((d) => ({
              id: d.doc_id,
              label: d.filename,
              text: `@${d.filename}`,
              detail: d.workspace_name,
              data: {
                docId: d.doc_id,
                documentName: d.filename,
                workspaceId: d.workspace_id,
                workspaceName: d.workspace_name,
              },
            }))
        },
      },
    ]
  }, [canMention, docId])

  const transport = useMemo<
    EventTransport<ClientStreamRequest, ClientStreamEvent<ClientMetadata>>
  >(() => {
    const client = createHttpClientTransport({
      endpoint: `${API_URL}/v1/chat/${docId}/${sessionId}`,
      format: 'jsonl',
      headers: () => ({
        'content-type': 'application/json',
        ...fpHeader(),
        ...(mentionsRef.current.length > 0
          ? { 'x-chat-mentions': mentionsRef.current.join(',') }
          : {}),
        ...(attachmentsRef.current.length > 0
          ? { 'x-chat-attachments': attachmentsRef.current.join(',') }
          : {}),
      }),
      body: ({ request }) => JSON.stringify(request),
      // Session cookie: the server scopes memory to `u:<id>` when logged in.
      init: { credentials: 'include' },
    })
    // useChat speaks positional send() and maps each yielded event via
    // eventToUIEvent, so unwrap the stream envelopes here (no resume in use).
    return {
      async *send(request, options) {
        const frames = client.send({
          request,
          abortSignal: options?.signal,
          headers: options?.headers,
        })
        for await (const frame of frames) {
          if (frame.type === 'stream_event') yield frame.event
        }
      },
    }
  }, [docId, sessionId])

  const chat = useChat({
    transport,
    initialMessages: initialHistory,
    createRequest: ({ uiMessages }): ClientStreamRequest => ({
      type: 'messages',
      messages: [{ role: 'user', content: lastUserText(uiMessages) }],
    }),
    eventToUIEvent: (event) =>
      clientEventToUIEvent(event, toolInputsRef.current),
    onEvent: (event) => {
      if (event.type === 'error') setStreamError(event.error.message)
    },
    onError: (err) => console.debug('[chat] transport error', err),
  })

  function beginTurn() {
    setStreamError(null)
  }

  // Animate the latest assistant answer while it streams: the model route
  // often delivers text in a single large delta, so reveal it gradually.
  // Only smooth when the assistant answer is the last message — between turns
  // (last message still the user's) the previous answer must not re-animate.
  const streaming = chat.status === 'streaming'
  const lastMessage = chat.messages.at(-1)
  const smoothTarget =
    streaming &&
    lastMessage?.role === 'assistant' &&
    lastMessage.parts.some((p) => p.type === 'text' && p.text)
      ? lastMessage
      : undefined
  const smoothFullText = smoothTarget
    ? smoothTarget.parts
        .flatMap((p) => (p.type === 'text' ? [p.text] : []))
        .join('\n')
    : ''
  const smooth = useSmoothStreamText(smoothFullText, {
    isStreaming: streaming,
    preset: 'balanced',
    // Single deltas can carry a whole answer — still animate them.
    largeAppendChars: 2_000,
  })
  const smoothedMessageId =
    smoothTarget && smooth.text !== smoothFullText
      ? smoothTarget.id
      : undefined

  const unavailable = indexing || gone

  return (
    <ChatProvider controller={chat}>
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <Thread.Root className="relative flex min-h-0 flex-1 flex-col">
          <Thread.Viewport
            autoScroll
            className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1"
          >
            <Thread.Empty className="py-6 text-sm text-fg-soft">
              {gone ? (
                t(signedIn ? 'chat.deletedEmpty' : 'chat.goneEmpty')
              ) : indexing ? (
                t('chat.indexingEmpty')
              ) : (
                <div>
                  <p className="font-medium text-fg">{t('chat.emptyTitle')}</p>
                  <ul className="mt-3 flex flex-wrap gap-2">
                    {SUGGESTION_KEYS.map((k) => (
                      <li key={k}>
                        <button
                          type="button"
                          onClick={() => {
                            beginTurn()
                            void chat.sendMessage(t(k))
                          }}
                          className="rounded-full border border-line px-3 py-1.5 text-left text-xs transition-colors hover:border-line-strong hover:bg-surface-2 hover:text-fg"
                        >
                          {t(k)}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </Thread.Empty>
            <Thread.Messages className="space-y-4">
              {(message) => {
                const smoothing = message.id === smoothedMessageId
                const firstTextId = smoothing
                  ? message.parts.find((p) => p.type === 'text')?.id
                  : undefined
                return (
                  <Message.Root
                    className={`group text-sm ${
                      message.role === 'user'
                        ? 'ml-auto w-fit max-w-[92%] rounded-md border border-line bg-surface-2 px-3.5 py-2.5'
                        : 'border-l-2 border-accent pl-3.5'
                    }`}
                  >
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <p className="label">
                        {message.role === 'user'
                          ? t('chat.you')
                          : t('chat.assistant')}
                      </p>
                      {message.role !== 'user' && <CopyMessage />}
                    </div>
                    {message.role === 'user' && (
                      <>
                        <MessageMentions />
                        <MessageAttachments />
                      </>
                    )}
                    <Message.Content>
                      <Message.Parts>
                        {() => (
                          <MessagePart
                            role={message.role}
                            smoothedText={smoothing ? smooth.text : undefined}
                            firstTextId={firstTextId}
                          />
                        )}
                      </Message.Parts>
                    </Message.Content>
                  </Message.Root>
                )
              }}
            </Thread.Messages>
            <Thread.Loading
              role="status"
              aria-live="polite"
              className="flex items-center gap-2 py-1 font-mono text-xs text-fg-soft"
            >
              <Spinner className="h-3.5 w-3.5" />
              {t('chat.generating')}
            </Thread.Loading>
            <Thread.Error>
              {(error) => (
                <Alert className="px-3 py-2 text-sm">
                  {describeChatError(error)}
                </Alert>
              )}
            </Thread.Error>
          </Thread.Viewport>
          <ScrollToBottom />
        </Thread.Root>

        {streamError && (
          <Alert className="shrink-0 px-3 py-2 text-sm">{streamError}</Alert>
        )}

        {unavailable ? (
          <p className="shrink-0 rounded-md border border-line bg-surface-2 px-3 py-2 text-sm text-fg-soft">
            {gone
              ? t(signedIn ? 'chat.docDeleted' : 'chat.docGone')
              : t('chat.waitingIndex')}
          </p>
        ) : (
          <>
            {canAttach && (
              <AttachmentTray
                items={tray.items}
                notice={tray.notice}
                onDismissNotice={() => tray.setNotice(null)}
                onRemove={tray.remove}
              />
            )}
            <AttachmentDropzone
              enabled={canAttach}
              onFiles={tray.addFiles}
            >
              <div className="shrink-0 rounded-lg border border-line-strong bg-bg p-2 transition-colors focus-within:border-fg-faint">
              <Composer.Root
                className="flex items-end gap-2"
                input={input}
                onInputChange={setInput}
                triggers={triggers}
                submitMessage={async ({
                  input: text,
                  chat: controller,
                  entities,
                  clear,
                }) => {
                  beginTurn()
                  // Hard guard: a submit racing a still-processing chip must
                  // never send stale ids (the server would 403/ignore them).
                  if (tray.busy) return
                  mentionsRef.current = entities
                    .filter((e) => e.triggerId === 'documents')
                    .map((e) => (e.data as MentionEntityData | undefined)?.docId)
                    .filter((id): id is string => Boolean(id))
                  attachmentsRef.current = tray.readyIds
                  clear()
                  try {
                    await controller.sendMessage(text)
                  } finally {
                    mentionsRef.current = []
                    attachmentsRef.current = []
                    tray.clearSent()
                  }
                }}
              >
                {canAttach && (
                  <>
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      accept=".pdf,.png,.jpg,.jpeg,.webp,.txt,.md,.markdown"
                      className="hidden"
                      onChange={(e) => {
                        tray.addFiles(Array.from(e.target.files ?? []))
                        e.currentTarget.value = ''
                      }}
                    />
                    <button
                      type="button"
                      aria-label={t('chat.attachAdd')}
                      title={t('chat.attachAdd')}
                      onClick={() => fileInputRef.current?.click()}
                      disabled={
                        tray.items.length >= MAX_ATTACHMENTS_PER_MESSAGE ||
                        tray.busy
                      }
                      className="shrink-0 rounded-md px-3 py-2 text-sm text-fg-soft transition-colors hover:bg-surface-2 hover:text-fg disabled:opacity-40"
                    >
                      <PlusIcon />
                    </button>
                  </>
                )}
            {canMention && (
              <MentionMenu>
                {(trigger) => {
                  if (trigger.loading) {
                    return (
                      <p className="px-3 py-2 text-sm text-fg-soft">
                        {t('chat.mentionSearching')}
                      </p>
                    )
                  }
                  if (trigger.items.length === 0) {
                    return (
                      <p className="px-3 py-2 text-sm text-fg-soft">
                        {t('chat.mentionEmpty')}
                      </p>
                    )
                  }
                  const groups = new Map<string, ComposerTriggerItem[]>()
                  for (const item of trigger.items) {
                    const group = mentionData(item).workspaceName || ''
                    const list = groups.get(group) ?? []
                    list.push(item)
                    groups.set(group, list)
                  }
                  return (
                    <div className="max-h-72 overflow-y-auto p-1">
                      {[...groups.entries()].map(([workspace, items]) => (
                        <div key={workspace || 'none'} className="py-1">
                          <p className="label px-2 pb-1 pt-1">
                            {workspace || t('chat.mentionNoWorkspace')}
                          </p>
                          {items.map((item) => (
                            <Composer.TriggerItem
                              key={item.id}
                              item={item}
                              index={trigger.items.indexOf(item)}
                              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors data-[active=true]:bg-surface-2 hover:bg-surface-2"
                            >
                              <span className="min-w-0 flex-1">
                                <span className="block truncate font-medium">
                                  {item.label}
                                </span>
                                <span className="block truncate font-mono text-[11px] text-fg-soft">
                                  {mentionData(item).workspaceName}
                                </span>
                              </span>
                            </Composer.TriggerItem>
                          ))}
                        </div>
                      ))}
                    </div>
                  )
                }}
              </MentionMenu>
            )}
            <Composer.Input
              minRows={3}
              maxRows={10}
              autoResize
              placeholder={
                canMention ? t('chat.placeholderMention') : t('chat.placeholder')
              }
              className="min-w-0 flex-1 bg-transparent px-2 py-1.5 text-sm outline-none"
            />
            {chat.status === 'streaming' ? (
              <Composer.Stop className="rounded-md border border-line-strong px-4 py-2 text-sm font-medium transition-colors hover:bg-surface-2">
                {t('chat.stop')}
              </Composer.Stop>
            ) : tray.busy ? (
              <button
                type="button"
                disabled
                className="flex shrink-0 items-center gap-1.5 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-ink opacity-40"
                title={t('chat.attachWait')}
              >
                {t('chat.send')} <SendIcon />
              </button>
            ) : (
              <Composer.Submit className="flex items-center gap-1.5 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-ink transition-opacity hover:opacity-90 disabled:opacity-40">
                {t('chat.send')} <SendIcon />
              </Composer.Submit>
            )}
              </Composer.Root>
              </div>
          </AttachmentDropzone>
          </>
        )}
      </div>
    </ChatProvider>
  )
}
