import blink from './examples/Blink.ino?raw'
import demoReel from './examples/DemoReel100.ino?raw'
import colorPalette from './examples/ColorPalette.ino?raw'
import fire from './examples/Fire2012.ino?raw'
import noise from './examples/NoisePlusPalette.ino?raw'

/** Unmodified FastLED 3.10.4 examples; provenance in docs/fastled/feasibility.md. */
export const FASTLED_DEMOS = [
  { id: 'Blink', name: 'Blink', source: blink },
  { id: 'DemoReel100', name: 'DemoReel100', source: demoReel },
  { id: 'ColorPalette', name: 'ColorPalette', source: colorPalette },
  { id: 'Fire2012', name: 'Fire2012', source: fire },
  { id: 'NoisePlusPalette', name: 'NoisePlusPalette', source: noise },
] as const
