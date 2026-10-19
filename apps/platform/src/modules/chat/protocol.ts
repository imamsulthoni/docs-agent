import type {
  ClientMetadata,
  ClientStreamEvent,
} from '@anvia/client'
import type { UIMessage, UIMessagePart, UIStreamEvent } from '@anvia/react'
import { t } from '../../lib/i18n'

/** Tool part of the installed @anvia/react UI model. */
export type UIToolPart = Extract<UIMessagePart, { type: 'tool' }>

/** JSON carried by the UI model (installed @anvia/react generation). */
type UIJson = NonNullable<UIToolPart['input']>

/**
 * The client transport and the React hook were built against different
 * @anvia/core generations, so their JSON types are nominally different.
 * Everything here already crossed a JSON wire — bridge it in one place.
 */
export function uiJson(value: unknown): UIJson {
  return value as UIJson
}

function runningToolPart(
  event: {
    partId: string
    toolCallId: string
    callId?: string
    toolName?: string
  },
  input = '',
): UIToolPart {
  return {
    id: event.partId,
    type: 'tool',
    toolName: event.toolName ?? 'tool',
    toolCallId: event.toolCallId,
    ...(event.callId ? { callId: event.callId } : {}),
    state: 'input-streaming',
    input,
  }
}

/** Fold one client-protocol event into a UI event (run/turn frames and data need no UI). */
export function clientEventToUIEvent(
  event: ClientStreamEvent<ClientMetadata>,
  toolInputs: Map<string, string>,
): UIStreamEvent | undefined {
  switch (event.type) {
    case 'text_delta':
      return {
        type: 'text_delta',
        messageId: event.messageId,
        partId: event.partId,
        delta: event.delta,
      }
    case 'reasoning_delta':
      return {
        type: 'reasoning_delta',
        messageId: event.messageId,
        partId: event.partId,
        delta: event.delta,
      }
    case 'tool_call_start': {
      toolInputs.set(event.partId, '')
      return {
        type: 'tool_update',
        messageId: event.messageId,
        partId: event.partId,
        part: runningToolPart(event),
      }
    }
    case 'tool_call_delta': {
      const input = (toolInputs.get(event.partId) ?? '') + event.delta
      toolInputs.set(event.partId, input)
      return {
        type: 'tool_update',
        messageId: event.messageId,
        partId: event.partId,
        part: runningToolPart(event, input),
      }
    }
    case 'tool_call_end':
      toolInputs.delete(event.partId)
      return {
        type: 'tool_update',
        messageId: event.messageId,
        partId: event.partId,
        part: {
          id: event.partId,
          type: 'tool',
          toolName: event.toolName,
          toolCallId: event.toolCallId,
          ...(event.callId ? { callId: event.callId } : {}),
          state: 'input-available',
          input: uiJson(event.input),
        },
      }
    case 'tool_result': {
      toolInputs.delete(event.partId)
      const base = {
        id: event.partId,
        type: 'tool' as const,
        toolName: event.toolName,
        toolCallId: event.toolCallId,
        ...(event.callId ? { callId: event.callId } : {}),
        input: uiJson(event.input),
      }
      return {
        type: 'tool_update',
        messageId: event.messageId,
        partId: event.partId,
        part:
          event.result.status === 'success'
            ? {
                ...base,
                state: 'output-available' as const,
                output: uiJson(event.result.output),
              }
            : {
                ...base,
                state: 'error' as const,
                error: { message: event.result.error.message },
              },
      }
    }
    case 'message_end':
      return { type: 'message_end', messageId: event.messageId }
    default:
      return undefined
  }
}

export const SUGGESTION_KEYS = ['chat.sug1', 'chat.sug2', 'chat.sug3'] as const

export function lastUserText(messages: UIMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (!m || m.role !== 'user') continue
    const text = m.parts
      .flatMap((part) => (part.type === 'text' ? [part.text] : []))
      .join('\n')
      .trim()
    if (text) return text
  }
  return ''
}

export function describeChatError(error: unknown): string {
  // Either transport package throws { response, body } on HTTP errors — read it structurally.
  const response = (error as { response?: unknown })?.response
  const body = (error as { body?: unknown })?.body
  if (response instanceof Response && typeof body === 'string') {
    try {
      const parsed = JSON.parse(body) as { detail?: unknown }
      if (typeof parsed.detail === 'string' && parsed.detail)
        return parsed.detail
    } catch {
      /* fall through to generic message */
    }
    return t('chat.errChatHttp', { status: response.status })
  }
  return error instanceof Error ? error.message : t('chat.errChat')
}

export function jsonText(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}
