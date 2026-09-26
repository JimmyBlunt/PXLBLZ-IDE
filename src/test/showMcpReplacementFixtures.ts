import type { ShowRecordV2 } from '../engine/showCompositionV2'

const RED = { id: 'mcp-red', name: 'Solid red', src: 'export function render2D(index, x, y) { rgb(1, 0, 0) }', controls: {}, updatedAt: 1 }
const GREEN = { id: 'mcp-green', name: 'Solid green', src: 'export function render2D(index, x, y) { rgb(0, 1, 0) }', controls: {}, updatedAt: 1 }
const BLUE = { id: 'mcp-blue', name: 'Solid blue', src: 'export function render2D(index, x, y) { rgb(0, 0, 1) }', controls: {}, updatedAt: 1 }

type Pattern = typeof RED
type Sample = { atMs: number; rgb: number[] }
type MapPoint = { sample: number[]; pos: [number, number] }

export interface ShowMcpReplacementCase {
  name: string
  patterns: Pattern[]
  mapPoints: MapPoint[]
  samples: Sample[]
  buildShow(id: string): ShowRecordV2
}

function record(id: string): ShowRecordV2 {
  return {
    version: 2,
    id,
    name: 'Ignored incoming name',
    zones: [{ id: 'left', name: 'Left', nominalPixelCount: 2 }],
    zoneLayouts: [{ id: 'layout', name: 'Full surface', zones: [], logical: { kind: 'single', zoneIds: ['left'] } }],
    outputContract: {
      version: 1, kind: 'portable-2d', referenceMapId: 'plane', referencePixelCount: 2,
      compatibility: { dimensions: [2], mapClass: 'continuous-surface', resolution: 'variable' },
    },
    composition: {
      version: 2, executionModel: 'continuous', showEndMs: 1_000,
      sampleRemap: { repeatScale: 1 }, patternInstances: [], layers: [], clips: [], transitions: [],
      layoutOccurrences: [{ id: 'layout-occurrence', layoutId: 'layout', startMs: 0, durationMs: 1_000, parameters: {} }],
      propertyTracks: [], markers: [], groupDefinitions: [], groupOccurrences: [],
    },
    updatedAt: 1,
  }
}

function instance(id: string, pattern: Pattern) {
  return { id, pattern: { kind: 'user' as const, id: pattern.id }, patternName: pattern.name, time: { timeScale: 1, timeOffsetMs: 0 } }
}

function clip(id: string, instanceId: string, layerId: string, zoneId: string, startMs: number, durationMs: number, opacity = 1) {
  return {
    id, instanceId, layerId, zoneId, startMs, durationMs,
    entryPolicy: 'continue' as const, zoneSampleMode: 'span' as const,
    appearance: { keys: [{ id: `${id}-appearance`, timeMs: startMs, value: { opacity, view: { mirror: false, phase: 0, brightness: 1 }, effects: [] } }] },
  }
}

const points = [{ sample: [0.25, 0.5], pos: [0.25, 0.5] as [number, number] }]

/** Fixed authored records and independent FastReplay linear-RGB values. */
export const showMcpReplacementCases: ShowMcpReplacementCase[] = [
  {
    name: 'solid red throughout', patterns: [RED], mapPoints: points,
    samples: [
      { atMs: 1, rgb: [1, 0, 0] }, { atMs: 250, rgb: [1, 0, 0] },
      { atMs: 500, rgb: [1, 0, 0] }, { atMs: 999, rgb: [1, 0, 0] },
    ],
    buildShow(id) {
      const show = record(id)
      show.composition.patternInstances = [instance('red-instance', RED)]
      show.composition.layers = [{ id: 'red-layer', zoneId: 'left', name: 'Red', rank: 0 }]
      show.composition.clips = [clip('red-clip', 'red-instance', 'red-layer', 'left', 0, 1_000)]
      return show
    },
  },
  {
    name: 'adjacent red then green at 500 ms', patterns: [RED, GREEN], mapPoints: points,
    samples: [
      { atMs: 1, rgb: [1, 0, 0] }, { atMs: 250, rgb: [1, 0, 0] },
      { atMs: 499, rgb: [1, 0, 0] }, { atMs: 500, rgb: [0, 1, 0] },
      { atMs: 501, rgb: [0, 1, 0] }, { atMs: 999, rgb: [0, 1, 0] },
    ],
    buildShow(id) {
      const show = record(id)
      show.composition.patternInstances = [instance('red-instance', RED), instance('green-instance', GREEN)]
      show.composition.layers = [{ id: 'color-layer', zoneId: 'left', name: 'Sequence', rank: 0 }]
      show.composition.clips = [
        clip('red-clip', 'red-instance', 'color-layer', 'left', 0, 500),
        clip('green-clip', 'green-instance', 'color-layer', 'left', 500, 500),
      ]
      return show
    },
  },
  {
    name: 'red below half-opacity blue', patterns: [RED, BLUE], mapPoints: points,
    samples: [
      { atMs: 1, rgb: [0.5, 0, 0.5] }, { atMs: 250, rgb: [0.5, 0, 0.5] },
      { atMs: 500, rgb: [0.5, 0, 0.5] }, { atMs: 999, rgb: [0.5, 0, 0.5] },
    ],
    buildShow(id) {
      const show = record(id)
      show.composition.patternInstances = [instance('red-instance', RED), instance('blue-instance', BLUE)]
      show.composition.layers = [
        { id: 'red-layer', zoneId: 'left', name: 'Lower red', rank: 0 },
        { id: 'blue-layer', zoneId: 'left', name: 'Upper blue', rank: 1 },
      ]
      show.composition.clips = [
        clip('red-clip', 'red-instance', 'red-layer', 'left', 0, 1_000),
        clip('blue-clip', 'blue-instance', 'blue-layer', 'left', 0, 1_000, 0.5),
      ]
      return show
    },
  },
  {
    name: 'two Zones route red left and green right', patterns: [RED, GREEN],
    mapPoints: [
      { sample: [0.25, 0.5], pos: [0.25, 0.5] },
      { sample: [0.75, 0.5], pos: [0.75, 0.5] },
    ],
    samples: [
      { atMs: 1, rgb: [1, 0, 0, 0, 1, 0] }, { atMs: 250, rgb: [1, 0, 0, 0, 1, 0] },
      { atMs: 500, rgb: [1, 0, 0, 0, 1, 0] }, { atMs: 999, rgb: [1, 0, 0, 0, 1, 0] },
    ],
    buildShow(id) {
      const show = record(id)
      show.zones = [{ id: 'left', name: 'Left', nominalPixelCount: 1 }, { id: 'right', name: 'Right', nominalPixelCount: 1 }]
      show.zoneLayouts = [{ id: 'layout', name: 'Left and right', zones: [], logical: { kind: 'split', axis: 'x', zoneIds: ['left', 'right'] } }]
      show.composition.patternInstances = [instance('red-instance', RED), instance('green-instance', GREEN)]
      show.composition.layers = [
        { id: 'red-layer', zoneId: 'left', name: 'Left red', rank: 0 },
        { id: 'green-layer', zoneId: 'right', name: 'Right green', rank: 0 },
      ]
      show.composition.clips = [
        clip('red-clip', 'red-instance', 'red-layer', 'left', 0, 1_000),
        clip('green-clip', 'green-instance', 'green-layer', 'right', 0, 1_000),
      ]
      return show
    },
  },
  {
    name: 'red linear opacity rises from zero to one', patterns: [RED], mapPoints: points,
    samples: [
      { atMs: 1, rgb: [0.001, 0, 0] }, { atMs: 250, rgb: [0.25, 0, 0] },
      { atMs: 500, rgb: [0.5, 0, 0] }, { atMs: 750, rgb: [0.75, 0, 0] },
      { atMs: 999, rgb: [0.999, 0, 0] },
    ],
    buildShow(id) {
      const show = record(id)
      show.composition.patternInstances = [instance('red-instance', RED)]
      show.composition.layers = [{ id: 'red-layer', zoneId: 'left', name: 'Red', rank: 0 }]
      show.composition.clips = [clip('red-clip', 'red-instance', 'red-layer', 'left', 0, 1_000)]
      show.composition.propertyTracks = [{
        id: 'opacity-track', target: { kind: 'clip-opacity', clipId: 'red-clip' },
        activeStartMs: 0, activeDurationMs: 1_000,
        keyframes: [
          { id: 'opacity-start', timeMs: 0, value: 0, easing: { curve: 'linear' } },
          { id: 'opacity-end', timeMs: 1_000, value: 1, easing: { curve: 'linear' } },
        ],
      }]
      return show
    },
  },
  {
    name: 'empty composition remains authorable', patterns: [], mapPoints: points, samples: [],
    buildShow: record,
  },
]
