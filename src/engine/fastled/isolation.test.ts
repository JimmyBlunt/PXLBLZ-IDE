import { fastLedIsolationHeaders } from './isolation'

describe('FastLED document isolation', () => {
  it.each(['/', '/PXLBLZ-IDE/', '/custom/tools/'])('isolates only the FastLED document under %s', (base) => {
    const expected = { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'credentialless' }
    expect(fastLedIsolationHeaders(`${base}fastled`, base)).toEqual(expected)
    expect(fastLedIsolationHeaders(`${base}fastled/`, base)).toEqual(expected)
    for (const suffix of ['', 'gallery', 'studio', 'api/auth/login', 'fastled-other', 'fastled/docs', 'assets/index-123.js']) {
      expect(fastLedIsolationHeaders(base + suffix, base)).toEqual({})
    }
  })

  it('isolates the dev and built runtime worker without changing unrelated assets', () => {
    const workerHeaders = { 'Cross-Origin-Embedder-Policy': 'credentialless' }
    expect(fastLedIsolationHeaders('/PXLBLZ-IDE/src/engine/fastled/runtime.worker.ts', '/PXLBLZ-IDE/')).toEqual(workerHeaders)
    expect(fastLedIsolationHeaders('/assets/runtime.worker-BuWCcSyi.js')).toEqual(workerHeaders)
    expect(fastLedIsolationHeaders('/assets/other.worker-BuWCcSyi.js')).toEqual({})
    expect(fastLedIsolationHeaders('/PXLBLZ-IDE/fastled', '/other/')).toEqual({})
  })
})
