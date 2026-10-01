import blink from './examples/Blink.ino?raw'
import demoReel from './examples/DemoReel100.ino?raw'
import colorPalette from './examples/ColorPalette.ino?raw'
import fire from './examples/Fire2012.ino?raw'
import noise from './examples/Noise.ino?raw'
import noisePalette from './examples/NoisePlusPalette.ino?raw'
import noiseHeader from './examples/NoisePlusPalette.h?raw'

export interface FastLedDemo {
  id: string
  name: string
  source: string
  files?: Record<string, string>
}

/** Unmodified FastLED 3.10.4 examples; provenance in docs/fastled/feasibility.md. */
export const FASTLED_DEMOS: readonly FastLedDemo[] = [
  { id: 'Blink', name: 'Blink', source: blink },
  { id: 'DemoReel100', name: 'DemoReel100', source: demoReel },
  { id: 'ColorPalette', name: 'ColorPalette', source: colorPalette },
  { id: 'Fire2012', name: 'Fire2012', source: fire },
  { id: 'Noise', name: 'Noise', source: noise },
  { id: 'NoisePlusPalette', name: 'NoisePlusPalette', source: noisePalette, files: { 'NoisePlusPalette.h': noiseHeader } },
] as const
