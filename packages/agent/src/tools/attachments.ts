import { createTool } from '@anvia/core'
import { z } from 'zod'
import type { AttachmentSearchHit } from '../types.js'

/**
 * Keyword search across the files uploaded in this chat session. Scope and
 * allow-list are enforced by the API callback (closure over owner + session);
 * the model never passes ids, so it cannot reach other chats.
 */
export function createAttachmentSearchTool(opts: {
  search: (query: string) => Promise<AttachmentSearchHit[]>
}) {
  return createTool({
    name: 'attachmentSearch',
    description:
      'Search the files the user uploaded in this chat session (previous messages) ' +
      'when the answer needs their content. Quote the file name shown in the results.',
    inputSchema: z.object({
      query: z
        .string()
        .min(1)
        .describe('Keywords from the question, e.g. invoice number or topic'),
    }),
    execute: async ({ query }) => {
      const hits = await opts.search(query)
      if (hits.length === 0) {
        return 'No matching passages in the uploaded files.'
      }
      return hits
        .map((hit) => `[${hit.filename}]\n${hit.snippet}`)
        .join('\n\n')
    },
  })
}
