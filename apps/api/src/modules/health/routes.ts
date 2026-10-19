import { Hono } from 'hono'
import { getHealthSnapshot } from './service.js'

const healthRoutes = new Hono()

function converterStatus(snapshot: Awaited<ReturnType<typeof getHealthSnapshot>>) {
  return snapshot.converter.reachable
    ? { status: 'ok' as const, version: snapshot.converter.version ?? 'unknown' }
    : { status: 'unreachable' as const }
}

/** Liveness probe - always returns ok if gateway is running */
healthRoutes.get('/health/live', (c) => c.json({ status: 'ok', service: 'api-gateway' }))

/** Readiness probe - checks converter reachability */
healthRoutes.get('/health/ready', async (c) => {
  const snapshot = await getHealthSnapshot()
  const ready = snapshot.converter.reachable
  return c.json(
    {
      status: ready ? 'ok' : 'not-ready',
      service: 'api-gateway',
      uptime_seconds: snapshot.uptimeSeconds,
      converter: converterStatus(snapshot),
    },
    ready ? 200 : 503,
  )
})

/** Combined health - for general monitoring */
healthRoutes.get('/health', async (c) => {
  const snapshot = await getHealthSnapshot()
  return c.json({
    status: snapshot.converter.reachable ? 'ok' : 'degraded',
    service: 'api-gateway',
    uptime_seconds: snapshot.uptimeSeconds,
    converter: converterStatus(snapshot),
  })
})

export { healthRoutes }
