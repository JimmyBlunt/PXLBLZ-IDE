/** Original FastLED WASM ABI, pinned to 3.10.4. Buffers are borrowed. */
export interface FastLedModule {
  HEAPU8: Uint8Array
  _malloc(size: number): number
  _free(pointer: number): void
  _getFrameData(sizePointer: number): number
  _freeFrameData(pointer: number): void
  _getStripPixelData(stripId: number, sizePointer: number): number
  _getScreenMapData?(sizePointer: number): number
  _extern_setup(): number | Promise<number>
  _extern_loop(): number | Promise<number>
}

/** Upstream ScreenMap geometry, in the same strip order as copyFastLedFrame. */
export function copyFastLedLayout(module: FastLedModule, pixelCount: number): [number, number][] | null {
  if (!module._getScreenMapData) return null
  const sizePointer = module._malloc(4)
  if (!sizePointer) throw new Error('FastLED could not allocate layout metadata.')
  let pointer = 0
  try {
    pointer = module._getScreenMapData(sizePointer)
    checkedRange(module.HEAPU8, sizePointer, 4)
    const length = new DataView(module.HEAPU8.buffer, module.HEAPU8.byteOffset).getInt32(sizePointer, true)
    if (length > 4 * 1024 * 1024) throw new Error('FastLED layout exceeds the preview limit.')
    checkedRange(module.HEAPU8, pointer, length)
    // Threaded WASM memory is shared; TextDecoder only accepts an unshared view.
    const json: unknown = JSON.parse(new TextDecoder().decode(module.HEAPU8.slice(pointer, pointer + length)).replace(/\0$/, ''))
    if (!json || typeof json !== 'object' || Array.isArray(json)) throw new Error('Invalid FastLED layout metadata.')
    const positions: [number, number][] = []
    const maps = json as Record<string, { strips?: Record<string, { map?: { x?: unknown; y?: unknown } }> }>
    const ids = Object.keys(maps)
    if (ids.some((id) => !/^\d+$/.test(id))) throw new Error('Invalid FastLED layout strip ID.')
    for (const id of ids.sort((a, b) => Number(a) - Number(b))) {
      const map = maps[id]?.strips?.[id]?.map
      if (!map || !Array.isArray(map.x) || !Array.isArray(map.y) || map.x.length !== map.y.length
        || positions.length + map.x.length > MAX_FRAME_BYTES / 3) throw new Error('Invalid FastLED layout coordinates.')
      for (let index = 0; index < map.x.length; index++) {
        const x: unknown = map.x[index], y: unknown = map.y[index]
        if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) throw new Error('Invalid FastLED layout coordinates.')
        positions.push([x, y])
      }
    }
    // Maps can be declared before all strips produce a frame. Do not associate
    // mismatched geometry with the current frame; the index grid remains valid.
    if (positions.length !== pixelCount || positions.length === 0) return null
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const [x, y] of positions) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y) }
    const extent = Math.max(maxX - minX, maxY - minY) || 1
    return positions.map(([x, y]) => [(x - minX - (maxX - minX) / 2) / extent + 0.5, (y - minY - (maxY - minY) / 2) / extent + 0.5])
  } finally {
    if (pointer) module._freeFrameData(pointer)
    module._free(sizePointer)
  }
}

const MAX_FRAME_BYTES = 3 * 65536

function checkedRange(memory: Uint8Array, pointer: number, size: number): void {
  if (!Number.isSafeInteger(pointer) || !Number.isSafeInteger(size) || pointer <= 0 || size < 0
    || pointer + size > memory.byteLength) throw new Error('FastLED returned an invalid memory range.')
}

/** Copies all strips before the next show can overwrite the WASM buffers. */
export function copyFastLedFrame(module: FastLedModule): Uint8Array {
  const sizePointer = module._malloc(4)
  if (!sizePointer) throw new Error('FastLED could not allocate frame metadata.')
  let metadataPointer = 0
  try {
    metadataPointer = module._getFrameData(sizePointer)
    const size = () => {
      checkedRange(module.HEAPU8, sizePointer, 4)
      return new DataView(module.HEAPU8.buffer, module.HEAPU8.byteOffset).getInt32(sizePointer, true)
    }
    const metadataLength = size()
    if (metadataLength > MAX_FRAME_BYTES) throw new Error('FastLED frame metadata exceeds the preview limit.')
    checkedRange(module.HEAPU8, metadataPointer, metadataLength)
    const metadata: unknown = JSON.parse(new TextDecoder().decode(module.HEAPU8.slice(metadataPointer, metadataPointer + metadataLength)).replace(/\0$/, ''))
    if (!Array.isArray(metadata)) throw new Error('FastLED returned invalid strip metadata.')
    const ids: number[] = []
    for (const item of metadata) {
      if (!item || item.type !== 'r8g8b8' || !Number.isSafeInteger(item.strip_id) || item.strip_id < 0 || ids.includes(item.strip_id)) {
        throw new Error('FastLED returned unsupported or duplicate strip metadata.')
      }
      ids.push(item.strip_id)
    }
    const strips: Uint8Array[] = []
    let total = 0
    for (const id of ids.sort((a, b) => a - b)) {
      const pointer = module._getStripPixelData(id, sizePointer)
      const length = size()
      if (length < 0 || length % 3 !== 0 || total + length > MAX_FRAME_BYTES) throw new Error('FastLED frame exceeds the preview limit or has invalid RGB data.')
      if (length === 0) continue
      checkedRange(module.HEAPU8, pointer, length)
      strips.push(module.HEAPU8.slice(pointer, pointer + length))
      total += length
    }
    const frame = new Uint8Array(total)
    let offset = 0
    for (const strip of strips) { frame.set(strip, offset); offset += strip.length }
    return frame
  } finally {
    if (metadataPointer) module._freeFrameData(metadataPointer)
    module._free(sizePointer)
  }
}
