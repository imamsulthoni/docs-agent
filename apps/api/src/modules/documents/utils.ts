export function bodyBytes(body: Buffer): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(body.byteLength)
  bytes.set(body)
  return bytes
}

/** Path under /public, or null when it is empty or tries to escape. */
export function publicRelativePath(pathname: string): string | null {
  const rest = pathname.replace(/^\/public\//, '')
  if (!rest || rest.includes('..')) return null
  return rest
}
