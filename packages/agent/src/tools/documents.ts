import { createTool } from '@anvia/core'
import { z } from 'zod'
import type { DocumentScope, RetrievedPage } from '../types.js'

/** Human-readable allow-list shown to the model in tool descriptions. */
function describeDocuments(documents: DocumentScope[]): string {
  return documents
    .map((d) => `- ${d.documentName} (docId ${d.docId})${d.active ? ' [active]' : ''}`)
    .join('\n')
}

function assertAllowed(documents: DocumentScope[], docId: string): DocumentScope {
  const doc = documents.find((d) => d.docId === docId)
  if (!doc) {
    // Allow-list enforcement: the model may only touch documents that were
    // resolved server-side for this turn (active doc + validated mentions).
    throw new Error(`Document ${docId} is not available in this conversation.`)
  }
  return doc
}

/**
 * Search one of the turn's documents. The caller supplies the actual search
 * implementation (API layer owns Qdrant/Prisma); the tool only enforces the
 * allow-list and shapes the result.
 */
export function createDocumentSearchTool(opts: {
  documents: DocumentScope[]
  search: (docId: string, query: string) => Promise<RetrievedPage[]>
}) {
  const { documents, search } = opts
  return createTool({
    name: 'documentSearch',
    description:
      `Search a document for passages relevant to the question. ` +
      `Always search before answering. Available documents:\n${describeDocuments(documents)}\n` +
      `Pass the docId of the document you want to search. Quote page numbers as p.<pageNumber> when citing.`,
    inputSchema: z.object({
      docId: z.string().describe('docId of the document to search (see the list above)'),
      query: z.string().min(1).describe('What to look for'),
    }),
    execute: async ({ docId, query }) => {
      const doc = assertAllowed(documents, docId)
      const pages = await search(docId, query)
      if (pages.length === 0) {
        return `No matching passages in ${doc.documentName}.`
      }
      return pages
        .map(
          (p) =>
            `[${doc.documentName} p.${p.pageNumber}]\n${p.content}`,
        )
        .join('\n\n')
    },
  })
}

/**
 * Read the full markdown of one page of one of the turn's documents. Pair with
 * documentSearch: search first for candidates, then read pages in full.
 */
export function createDocumentReadTool(opts: {
  documents: DocumentScope[]
  readPage: (docId: string, pageNumber: number) => Promise<string | null>
}) {
  const { documents, readPage } = opts
  return createTool({
    name: 'documentReadPage',
    description:
      `Read the complete markdown content of one page. Available documents:\n${describeDocuments(documents)}\n` +
      `Use after documentSearch when a passage needs full context.`,
    inputSchema: z.object({
      docId: z.string().describe('docId of the document to read (see the list above)'),
      pageNumber: z.number().int().min(1).describe('1-based page number to read'),
    }),
    execute: async ({ docId, pageNumber }) => {
      const doc = assertAllowed(documents, docId)
      const content = await readPage(docId, pageNumber)
      return (
        content ??
        `Page ${pageNumber} not found in ${doc.documentName} (${docId}).`
      )
    },
  })
}
