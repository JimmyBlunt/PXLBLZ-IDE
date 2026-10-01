import { parseFastLedProject, serializeFastLedProject, validateFastLedFiles } from './project'

function project(files: Record<string, unknown> = {}, source = '') {
  return JSON.stringify({ format: 'pxlblz-fastled', version: 1, name: 'NoisePlusPalette', source, files })
}

describe('FastLED project files', () => {
  it('round trips source and headers without changing their contents', () => {
    const original = { name: 'NoisePlusPalette', source: '#include "NoisePlusPalette.h"\n', files: { 'NoisePlusPalette.h': '// ü\nvoid setup() {}\nvoid loop() {}\n' } }
    expect(parseFastLedProject(serializeFastLedProject(original))).toEqual({ format: 'pxlblz-fastled', version: 1, ...original })
  })

  it('keeps broken and empty source in a project', () => {
    expect(parseFastLedProject(project({}, 'void broken(')).source).toBe('void broken(')
    expect(parseFastLedProject(project()).source).toBe('')
  })

  it.each(['../secret.h', '/secret.h', 'subdir/code.cpp', 'C:\\secret.h', 'file..h', 'pxlblz-frame-adapter.h', 'NUL.h', '.hidden.h', 'script.js', 'Sketch.ino'])('rejects unsafe or unsupported file %s', (name) => {
    expect(() => parseFastLedProject(project({ [name]: '' }))).toThrow()
  })

  it('rejects invalid project envelopes and non-text files', () => {
    expect(() => parseFastLedProject('not JSON')).toThrow('valid JSON')
    expect(() => parseFastLedProject(JSON.stringify({ format: 'pxlblz-fastled', version: 2 }))).toThrow('version')
    expect(() => parseFastLedProject(project({ 'source.h': { arbitrary: true } }))).toThrow('text')
    expect(() => parseFastLedProject(project({ 'source.h': '', 'SOURCE.h': '' }))).toThrow('unique')
  })

  it('bounds aggregate UTF-8 bytes and the number of files', () => {
    expect(() => validateFastLedFiles('é'.repeat(524289), {})).toThrow('1 MiB')
    expect(() => validateFastLedFiles('x'.repeat(1024 * 1024), { 'extra.h': 'x' })).toThrow('1 MiB')
    expect(() => validateFastLedFiles('', Object.fromEntries(Array.from({ length: 33 }, (_, i) => [`file${i}.h`, ''])))).toThrow('32')
  })
})
