export const FASTLED_EXAMPLE_MANIFEST = {
  schemaVersion: 1,
  fastledVersion: '3.10.4',
  upstreamCommit: 'adedfc40e73fb80f8e930318781036d8fe1dbd9f',
  license: 'MIT',
  provenance: 'https://github.com/FastLED/FastLED/tree/adedfc40e73fb80f8e930318781036d8fe1dbd9f/examples',
  folders: [
    {
      id: 'standard',
      title: 'Standard examples',
      entries: [
        { id: 'Blink', title: 'Blink', sourceFiles: ['Blink.ino'], dimension: { kind: 'strip', pixels: 1 } },
        { id: 'DemoReel100', title: 'DemoReel100', sourceFiles: ['DemoReel100.ino'], dimension: { kind: 'strip', pixels: 64 } },
        { id: 'ColorPalette', title: 'ColorPalette', sourceFiles: ['ColorPalette.ino'], dimension: { kind: 'strip', pixels: 16 } },
        { id: 'Fire2012', title: 'Fire2012', sourceFiles: ['Fire2012.ino'], dimension: { kind: 'strip', pixels: 30 } },
        { id: 'Noise', title: 'Noise', sourceFiles: ['Noise.ino'], dimension: { kind: 'matrix', width: 16, height: 16, pixels: 256 } },
        { id: 'NoisePlusPalette', title: 'NoisePlusPalette', sourceFiles: ['NoisePlusPalette.ino', 'NoisePlusPalette.h'], dimension: { kind: 'matrix', width: 16, height: 16, pixels: 256 } },
      ],
    },
    {
      id: 'matrix',
      title: 'Matrix & geometry',
      entries: [
        { id: 'Animartrix', title: 'Animartrix', sourceFiles: ['Animartrix.ino'], dimension: { kind: 'matrix', width: 64, height: 64, pixels: 4096 } },
        { id: 'WasmScreenCoords', title: 'WasmScreenCoords', sourceFiles: ['WasmScreenCoords.ino'], dimension: { kind: 'multi-strip', strips: 2, pixelsPerStrip: 256, pixels: 512 } },
      ],
    },
  ],
} as const

export type FastLedManifestFolder = typeof FASTLED_EXAMPLE_MANIFEST.folders[number]
export type FastLedManifestEntry = FastLedManifestFolder['entries'][number]
