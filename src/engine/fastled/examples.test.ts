import { describe, expect, it } from 'vitest'
import { FASTLED_DEMOS, FASTLED_EXAMPLE_MANIFEST } from './examples'

describe('FastLED example manifest', () => {
  it('pins provenance and exposes all eight acceptance examples', () => {
    expect(FASTLED_EXAMPLE_MANIFEST).toMatchObject({
      schemaVersion: 1,
      fastledVersion: '3.10.4',
      upstreamCommit: 'adedfc40e73fb80f8e930318781036d8fe1dbd9f',
      license: 'MIT',
    })
    expect(FASTLED_DEMOS.map((demo) => demo.id)).toEqual([
      'Blink',
      'DemoReel100',
      'ColorPalette',
      'Fire2012',
      'Noise',
      'NoisePlusPalette',
      'Animartrix',
      'WasmScreenCoords',
    ])
  })

  it('records the matrix acceptance dimensions without modifying source files', () => {
    const animartrix = FASTLED_DEMOS.find((demo) => demo.id === 'Animartrix')
    const coords = FASTLED_DEMOS.find((demo) => demo.id === 'WasmScreenCoords')
    expect(animartrix?.metadata.dimension).toEqual({ kind: 'matrix', width: 64, height: 64, pixels: 4096 })
    expect(coords?.metadata.dimension).toEqual({ kind: 'multi-strip', strips: 2, pixelsPerStrip: 256, pixels: 512 })
    expect(animartrix?.metadata.sourceFiles).toEqual(['Animartrix.ino'])
    expect(coords?.metadata.sourceFiles).toEqual(['WasmScreenCoords.ino'])
  })
})
