/** Only the FastLED document and its dedicated worker need shared-memory access. */
export function fastLedIsolationHeaders(pathname: string, base = '/'): Record<string, string> {
  const prefix = `/${base.split('/').filter(Boolean).join('/')}`
  const normalizedBase = prefix === '/' ? '/' : `${prefix}/`
  if (!pathname.startsWith(normalizedBase)) return {}
  const relative = `/${pathname.slice(normalizedBase.length)}`
  if (relative === '/fastled' || relative === '/fastled/') {
    return {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless',
    }
  }
  if (relative === '/src/engine/fastled/runtime.worker.ts'
    || /^\/assets\/runtime\.worker-[a-z0-9_-]+\.js$/i.test(relative)) {
    return { 'Cross-Origin-Embedder-Policy': 'credentialless' }
  }
  return {}
}
