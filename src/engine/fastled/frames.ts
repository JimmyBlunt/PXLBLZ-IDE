/** Original FastLED WASM ABI, pinned to 3.10.4. Buffers are borrowed. */
export interface FastLedModule {
  HEAPU8: Uint8Array
  _malloc(size: number): number
  _free(pointer: number): void
  _getFrameData(sizePointer: number): number
  _freeFrameData(pointer: number): void
  _getStripPixelData(stripId: number, sizePointer: number): number
  _extern_setup(): number | Promise<number>
  _extern_loop(): number | Promise<number>
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
    const metadata: unknown = JSON.parse(new TextDecoder().decode(module.HEAPU8.subarray(metadataPointer, metadataPointer + metadataLength)).replace(/\0$/, ''))
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
