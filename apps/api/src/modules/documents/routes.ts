import { Hono } from 'hono'
import { DOC_ID_RE, sessionUserId } from '../../config.js'
import { auth } from '../auth/auth.js'
import { loadSession, type AuthVariables } from '../auth/middleware.js'
import { getOwnerDocuments, getOwnerLandingDocuments, getMentionableDocuments } from '../workspaces/service.js'
import { isPersistentDoc, readArtifactMeta, readPublicFile } from './artifacts.js'
import { deleteDocument, getMarkdownDownload, listDocuments } from './service.js'
import { bodyBytes, publicRelativePath } from './utils.js'

const documentsRoutes = new Hono<{ Variables: AuthVariables }>()

/**
 * List documents. `?scope=landing` is the anonymous landing library: workspace
 * docs are excluded there because they belong to the dashboard. Logged-in
 * users otherwise get their own docs from Postgres; guests fall back to the
 * disk listing (anonymous, expiring docs only).
 */
documentsRoutes.get('/documents', loadSession, async (c) => {
  const user = c.get('user')
  if (user) {
    const owner = sessionUserId(user.id)
    const documents =
      c.req.query('scope') === 'landing'
        ? await getOwnerLandingDocuments(owner)
        : await getOwnerDocuments(owner)
    return c.json({ documents })
  }
  const documents = await listDocuments()
  return c.json({ documents })
})

/**
 * `@` picker candidates for a logged-in user: owned, indexed documents inside
 * any workspace. Landing docs and guest docs are never mentionable, and the
 * document currently open in the chat is excluded.
 */
documentsRoutes.get('/mentionable-documents', loadSession, async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ detail: 'Authentication required.' }, 401)
  const exclude = c.req.query('exclude')
  const documents = await getMentionableDocuments(
    sessionUserId(user.id),
    c.req.query('q') ?? '',
    exclude && DOC_ID_RE.test(exclude) ? exclude : undefined,
  )
  return c.json({ documents })
})

/** Download markdown file */
documentsRoutes.get('/download/:docId', async (c) => {
  const docId = c.req.param('docId')
  if (!DOC_ID_RE.test(docId)) return c.json({ detail: 'Invalid doc_id.' }, 400)
  const file = await getMarkdownDownload(docId)
  if (!file) return c.json({ detail: 'Markdown not found / expired.' }, 404)
  return new Response(bodyBytes(file.body), {
    headers: {
      'content-type': 'text/markdown; charset=utf-8',
      'content-disposition': `attachment; filename="${docId}.md"`,
    },
  })
})

/** Delete document artifacts and gateway state. */
documentsRoutes.delete('/documents/:docId', async (c) => {
  const docId = c.req.param('docId')
  if (!DOC_ID_RE.test(docId)) return c.json({ detail: 'Invalid doc_id.' }, 400)
  await deleteDocument(docId)
  return c.json({ doc_id: docId, deleted: true })
})

/** Serve stored markdown and images at the URLs embedded in the markdown. */
const publicRoutes = new Hono()

publicRoutes.get('/public/*', async (c) => {
  const rest = publicRelativePath(c.req.path)
  if (!rest) return c.json({ detail: 'Not found.' }, 404)

  // Persistent (workspace-owned) docs are private: their frozen /public URLs
  // must only serve the owner. Guests stay open (opaque 32-hex docId, expiring).
  const docId = rest.split('/')[0] ?? ''
  const meta = await readArtifactMeta(docId)
  if (meta && isPersistentDoc(meta)) {
    const session = await auth.api.getSession({ headers: c.req.raw.headers })
    const identity = session?.user ? sessionUserId(session.user.id) : null
    if (!identity || identity !== meta.owner_id) {
      // 404 (not 403): do not reveal that the document exists.
      return c.json({ detail: 'Not found.' }, 404)
    }
  }

  const file = await readPublicFile(rest)
  if (!file) return c.json({ detail: 'Not found.' }, 404)
  return new Response(bodyBytes(file.body), {
    headers: { 'content-type': file.contentType },
  })
})

export { documentsRoutes, publicRoutes }
