// One bounded latest-frame slot. The UI can read it while C++ blocks its worker.
// An odd sequence means the writer is copying; readers discard torn snapshots.
export const FASTLED_MAX_FRAME_BYTES = 3 * 65536
const HEADER_BYTES = 16
const LAYOUT_OFFSET = HEADER_BYTES + FASTLED_MAX_FRAME_BYTES

export function createFastLedMailbox(): SharedArrayBuffer {
  return new SharedArrayBuffer(LAYOUT_OFFSET + (FASTLED_MAX_FRAME_BYTES / 3) * 2 * 8)
}

export function writeFastLedMailbox(buffer: SharedArrayBuffer, frame: Uint8Array, positions?: [number, number][] | null): void {
  if (frame.length > FASTLED_MAX_FRAME_BYTES || frame.length % 3 !== 0) throw new Error('Invalid FastLED mailbox frame.')
  if (positions && (positions.length > FASTLED_MAX_FRAME_BYTES / 3
    || positions.some(([x, y]) => !Number.isFinite(x) || !Number.isFinite(y)))) throw new Error('Invalid FastLED mailbox layout.')
  const header = new Int32Array(buffer, 0, 4)
  Atomics.add(header, 0, 1)
  new Uint8Array(buffer, HEADER_BYTES, FASTLED_MAX_FRAME_BYTES).set(frame)
  Atomics.store(header, 1, frame.length)
  if (positions !== undefined) {
    const geometry = new Float64Array(buffer, LAYOUT_OFFSET)
    for (let index = 0; index < (positions?.length ?? 0); index++) {
      geometry[index * 2] = positions![index][0]
      geometry[index * 2 + 1] = positions![index][1]
    }
    Atomics.store(header, 2, positions?.length ?? 0)
    Atomics.add(header, 3, 1)
  }
  Atomics.add(header, 0, 1)
}

export function readFastLedMailbox(buffer: SharedArrayBuffer, previousSequence: number, previousLayoutVersion = -1): {
  sequence: number; frame: Uint8Array; layoutVersion: number; positions?: [number, number][]
} | null {
  const header = new Int32Array(buffer, 0, 4)
  const sequence = Atomics.load(header, 0)
  if (sequence === previousSequence || sequence % 2 !== 0) return null
  const length = Atomics.load(header, 1)
  if (length < 0 || length > FASTLED_MAX_FRAME_BYTES || length % 3 !== 0) throw new Error('Invalid FastLED mailbox frame size.')
  const frame = new Uint8Array(buffer, HEADER_BYTES, length).slice()
  const layoutVersion = Atomics.load(header, 3)
  let positions: [number, number][] | undefined
  if (layoutVersion !== previousLayoutVersion) {
    const count = Atomics.load(header, 2)
    if (count < 0 || count > FASTLED_MAX_FRAME_BYTES / 3) throw new Error('Invalid FastLED mailbox layout size.')
    const geometry = new Float64Array(buffer, LAYOUT_OFFSET, count * 2)
    positions = Array.from({ length: count }, (_, index) => [geometry[index * 2], geometry[index * 2 + 1]])
  }
  if (Atomics.load(header, 0) !== sequence) return null
  return { sequence, frame, layoutVersion, positions }
}
