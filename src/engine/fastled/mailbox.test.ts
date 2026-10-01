import { describe, expect, it } from 'vitest'
import { createFastLedMailbox, readFastLedMailbox, writeFastLedMailbox } from './mailbox'

describe('FastLED latest-frame mailbox', () => {
  it('retains the last show when several shows precede a blocking delay', () => {
    const buffer = createFastLedMailbox()
    expect(readFastLedMailbox(buffer, 0)).toBeNull()
    writeFastLedMailbox(buffer, new Uint8Array([255, 0, 0]))
    writeFastLedMailbox(buffer, new Uint8Array([0, 0, 255]))
    const result = readFastLedMailbox(buffer, 0)!
    expect([...result.frame]).toEqual([0, 0, 255])
    expect(readFastLedMailbox(buffer, result.sequence)).toBeNull()
    writeFastLedMailbox(buffer, new Uint8Array([0, 255, 0]))
    expect([...result.frame]).toEqual([0, 0, 255])
  })
  it('does not read a partially written frame', () => {
    const buffer = createFastLedMailbox()
    writeFastLedMailbox(buffer, new Uint8Array([1, 2, 3]))
    Atomics.add(new Int32Array(buffer, 0, 2), 0, 1)
    expect(readFastLedMailbox(buffer, 0)).toBeNull()
  })
  it('keeps the latest geometry with its RGB frame and only recopies changed layouts', () => {
    const buffer = createFastLedMailbox()
    writeFastLedMailbox(buffer, new Uint8Array([255, 0, 0]), [[0, 0]])
    const old = readFastLedMailbox(buffer, 0)!
    writeFastLedMailbox(buffer, new Uint8Array([0, 0, 255]), [[1, 1]])
    const latest = readFastLedMailbox(buffer, old.sequence, old.layoutVersion)!
    expect(latest.positions).toEqual([[1, 1]])
    expect([...latest.frame]).toEqual([0, 0, 255])
    writeFastLedMailbox(buffer, new Uint8Array([1, 2, 3]))
    expect(readFastLedMailbox(buffer, latest.sequence, latest.layoutVersion)!.positions).toBeUndefined()
    writeFastLedMailbox(buffer, new Uint8Array([1, 2, 3]), null)
    expect(readFastLedMailbox(buffer, latest.sequence, latest.layoutVersion)!.positions).toEqual([])
    expect(old.positions).toEqual([[0, 0]])
  })
  it('bounds storage even when a sketch emits many shows', () => {
    const buffer = createFastLedMailbox()
    const size = buffer.byteLength
    for (let index = 0; index < 10000; index++) writeFastLedMailbox(buffer, new Uint8Array([index % 256, 0, 0]))
    expect(buffer.byteLength).toBe(size)
    expect([...readFastLedMailbox(buffer, 0)!.frame]).toEqual([9999 % 256, 0, 0])
    expect(() => writeFastLedMailbox(buffer, new Uint8Array(4))).toThrow('Invalid')
  })
})
