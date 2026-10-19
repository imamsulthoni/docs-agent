import { converterClient } from '../converter/client.js'

const startedAt = Date.now()

export type HealthSnapshot = {
  uptimeSeconds: number
  converter: { reachable: boolean; version?: string }
}

export async function getHealthSnapshot(): Promise<HealthSnapshot> {
  const converter = await converterClient.health()
  return {
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    converter,
  }
}
