import blink from './examples/Blink.ino?raw'
import demoReel from './examples/DemoReel100.ino?raw'
import colorPalette from './examples/ColorPalette.ino?raw'
import fire from './examples/Fire2012.ino?raw'
import noise from './examples/Noise.ino?raw'
import noisePalette from './examples/NoisePlusPalette.ino?raw'
import noiseHeader from './examples/NoisePlusPalette.h?raw'
import animartrix from './examples/Animartrix.ino?raw'
import wasmScreenCoords from './examples/WasmScreenCoords.ino?raw'
import { FASTLED_EXAMPLE_MANIFEST, type FastLedManifestEntry } from './examples/manifest'

export { FASTLED_EXAMPLE_MANIFEST } from './examples/manifest'

export interface FastLedDemo {
  id: string
  name: string
  folder: string
  source: string
  files?: Record<string, string>
  metadata: FastLedManifestEntry
}

const SOURCES: Record<string, { source: string; files?: Record<string, string> }> = {
  Blink: { source: blink },
  DemoReel100: { source: demoReel },
  ColorPalette: { source: colorPalette },
  Fire2012: { source: fire },
  Noise: { source: noise },
  NoisePlusPalette: { source: noisePalette, files: { 'NoisePlusPalette.h': noiseHeader } },
  Animartrix: { source: animartrix },
  WasmScreenCoords: { source: wasmScreenCoords },
}

/**
 * Unmodified FastLED 3.10.4 example sources. IDE metadata is kept in the
 * versioned manifest beside the examples rather than inserted into upstream C++.
 */
export const FASTLED_DEMOS: readonly FastLedDemo[] = FASTLED_EXAMPLE_MANIFEST.folders.flatMap((folder) =>
  folder.entries.map((entry) => {
    const loaded = SOURCES[entry.id]
    if (!loaded) throw new Error(`Missing bundled FastLED source for ${entry.id}`)
    return { id: entry.id, name: entry.title, folder: folder.title, metadata: entry, ...loaded }
  }),
)
