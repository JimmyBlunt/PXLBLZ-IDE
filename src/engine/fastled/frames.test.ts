import { describe, expect, it } from 'vitest'
import { copyFastLedFrame, type FastLedModule } from './frames'

function fixture(metadata: unknown = [{ strip_id: 3, type: 'r8g8b8' }, { strip_id: 1, type: 'r8g8b8' }]) {
  const freed: number[] = []
  const memory = new Uint8Array(1024)
  const json = new TextEncoder().encode(JSON.stringify(metadata))
  memory.set(json, 32)
  memory.set([10, 20, 30], 512)
  memory.set([255, 0, 128], 600)
  const size = (n: number) => new DataView(memory.buffer).setInt32(4, n, true)
  const module: FastLedModule = {
    HEAPU8: memory, _malloc: () => 4, _free: (p) => freed.push(p),
    _getFrameData: () => { size(json.length); return 32 }, _freeFrameData: (p) => freed.push(p),
    _getStripPixelData: (id) => { size(3); return id === 1 ? 512 : 600 },
    _extern_setup: () => 0, _extern_loop: () => 0,
  }
  return { module, memory, freed, size }
}

describe('FastLED frame ABI', () => {
  it('orders strips by stable ID and copies borrowed memory before the next show', () => {
    const { module, memory, freed } = fixture()
    const result = copyFastLedFrame(module)
    memory.fill(0)
    expect([...result]).toEqual([10, 20, 30, 255, 0, 128])
    expect(freed).toEqual([32, 4]) // borrowed strip pointers must never be freed
  })
  it('cleans up metadata when strips are malformed or duplicated', () => {
    for (const metadata of [[{ strip_id: 1, type: 'rgbw' }], [{ strip_id: 0, type: 'r8g8b8' }, { strip_id: 0, type: 'r8g8b8' }]]) {
      const { module, freed } = fixture(metadata)
      expect(() => copyFastLedFrame(module)).toThrow(/metadata/)
      expect(freed).toEqual([32, 4])
    }
  })
  it('rejects out-of-bounds RGB and non-triplet sizes rather than drawing corrupt data', () => {
    const { module, size, freed } = fixture()
    module._getStripPixelData = () => { size(6); return 1020 }
    expect(() => copyFastLedFrame(module)).toThrow(/memory range/)
    expect(freed).toEqual([32, 4])
    module._getStripPixelData = () => { size(4); return 512 }
    expect(() => copyFastLedFrame(module)).toThrow(/invalid RGB/)
  })
  it('allows no strips before the sketch first calls show', () => {
    expect(copyFastLedFrame(fixture([]).module)).toEqual(new Uint8Array())
  })
})
