import { Hono, type Context } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { bodyLimit } from 'hono/body-limit'
import { MAX_UPLOAD_BYTES, DOC_ID_RE, sessionUserId } from '../../config.js'
import { requireAuth, type AuthVariables } from '../auth/middleware.js'
import { stripImageBytes } from '../documents/artifacts.js'
import { getConversionJob } from '../converter/service.js'
import { runAsyncConvert, runSyncConvert } from '../converter/routes.js'
import {
  addWorkspace,
  getWorkspace,
  getWorkspaceDocuments,
  getWorkspaces,
  removeWorkspace,
  updateWorkspace,
} from './service.js'
import { parseWorkspaceName } from './utils.js'

type Ctx = Context<{ Variables: AuthVariables }>

const workspaceRoutes = new Hono<{ Variables: AuthVariables }>()

// Every workspace route is login-only and scoped to the session's owner.
// Scoped to `/workspaces/*` (not `/*`): this sub-app is mounted at the v1 root,
// so a bare wildcard would also gate every sibling route (chat, status, debug).
workspaceRoutes.use('/workspaces', requireAuth)
workspaceRoutes.use('/workspaces/*', requireAuth)

workspaceRoutes.use(
  '/workspaces/:id/convert*',
  bodyLimit({ maxSize: MAX_UPLOAD_BYTES + 1024 * 1024 }),
)

function ownerId(c: Ctx): string {
  const user = c.get('user')
  if (!user) throw new HTTPException(401, { message: 'Authentication required.' })
  return sessionUserId(user.id)
}

/** List the caller's workspaces. */
workspaceRoutes.get('/workspaces', async (c) => {
  const workspaces = await getWorkspaces(ownerId(c))
  return c.json({ workspaces })
})

/** Create a workspace. */
workspaceRoutes.post('/workspaces', async (c) => {
  const parsed = parseWorkspaceName(await c.req.json().catch(() => null))
  if (!parsed.ok) return c.json({ detail: parsed.detail }, parsed.status)
  const workspace = await addWorkspace(ownerId(c), parsed.name)
  return c.json({ workspace }, 201)
})

/** One workspace (owner-scoped). */
workspaceRoutes.get('/workspaces/:id', async (c) => {
  const workspace = await getWorkspace(c.req.param('id'), ownerId(c))
  if (!workspace) return c.json({ detail: 'Workspace not found.' }, 404)
  return c.json({ workspace })
})

/** Rename a workspace. */
workspaceRoutes.patch('/workspaces/:id', async (c) => {
  const parsed = parseWorkspaceName(await c.req.json().catch(() => null))
  if (!parsed.ok) return c.json({ detail: parsed.detail }, parsed.status)
  const workspace = await updateWorkspace(c.req.param('id'), ownerId(c), parsed.name)
  if (!workspace) return c.json({ detail: 'Workspace not found.' }, 404)
  return c.json({ workspace })
})

/** Delete a workspace and all its documents (artifact + DB + vectors + memory). */
workspaceRoutes.delete('/workspaces/:id', async (c) => {
  const ok = await removeWorkspace(c.req.param('id'), ownerId(c))
  if (!ok) return c.json({ detail: 'Workspace not found.' }, 404)
  return c.json({ deleted: true })
})

/** Documents inside one workspace (from Postgres, not disk). */
workspaceRoutes.get('/workspaces/:id/documents', async (c) => {
  const documents = await getWorkspaceDocuments(c.req.param('id'), ownerId(c))
  if (documents === null) return c.json({ detail: 'Workspace not found.' }, 404)
  return c.json({ documents })
})

/** Upload + convert a PDF into a workspace (sync). */
workspaceRoutes.post('/workspaces/:id/convert', async (c) => {
  const id = c.req.param('id')
  const owner = ownerId(c)
  if (!(await getWorkspace(id, owner))) {
    return c.json({ detail: 'Workspace not found.' }, 404)
  }
  return runSyncConvert(c, { ownerId: owner, workspaceId: id })
})

/** Upload + convert a PDF into a workspace (async job). */
workspaceRoutes.post('/workspaces/:id/convert/jobs', async (c) => {
  const id = c.req.param('id')
  const owner = ownerId(c)
  if (!(await getWorkspace(id, owner))) {
    return c.json({ detail: 'Workspace not found.' }, 404)
  }
  return runAsyncConvert(c)
})

/** Poll a workspace conversion; the finished doc is attributed to the workspace. */
workspaceRoutes.get('/workspaces/:id/convert/jobs/:jobId', async (c) => {
  const id = c.req.param('id')
  const owner = ownerId(c)
  if (!(await getWorkspace(id, owner))) {
    return c.json({ detail: 'Workspace not found.' }, 404)
  }
  const jobId = c.req.param('jobId')
  if (!DOC_ID_RE.test(jobId)) return c.json({ detail: 'Invalid job id.' }, 400)
  const result = await getConversionJob(
    jobId,
    c.get('requestId') as string | undefined,
    { ownerId: owner, workspaceId: id },
  )
  if (result.type === 'not-found') {
    return c.json({ detail: 'Job not found or expired.' }, 404)
  }
  if (result.type === 'unavailable') {
    return c.json({ detail: 'Conversion service unavailable.' }, 502)
  }
  if (result.type === 'bad-json') {
    return c.json({ detail: 'Conversion response was not JSON.' }, 502)
  }
  if (result.type === 'store-failed') {
    return c.json({ detail: result.detail }, result.status)
  }
  return c.json(stripImageBytes(result.job))
})

export { workspaceRoutes }
