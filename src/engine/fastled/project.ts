export const FASTLED_PROJECT_MAX_BYTES = 1024 * 1024
export const FASTLED_PROJECT_MAX_FILES = 32

export interface FastLedProject {
  format: 'pxlblz-fastled'
  version: 1
  name: string
  source: string
  files: Record<string, string>
}

export function validateFastLedFilename(name: string): void {
  if (name.length > 128 || name.includes('..') || !/^[a-z0-9][a-z0-9_.-]*\.(?:h|hpp|cpp)$/i.test(name)
    || (/\.cpp$/i.test(name) && !name.endsWith('.cpp'))
    || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])\./i.test(name)
    || name.toLowerCase() === 'pxlblz-frame-adapter.h') {
    throw new Error('Support files need a simple .h, .hpp or lowercase .cpp filename without folders or reserved names. This compiler does not compile .c or uppercase .CPP files.')
  }
}

/** Shared by project imports and individual file edits/imports. */
export function validateFastLedFiles(source: string, files: Record<string, string>): void {
  const entries = Object.entries(files)
  if (entries.length > FASTLED_PROJECT_MAX_FILES) throw new Error(`A project supports at most ${FASTLED_PROJECT_MAX_FILES} additional files.`)
  const names = new Set<string>()
  const encoder = new TextEncoder()
  let bytes = encoder.encode(source).length
  for (const [name, contents] of entries) {
    validateFastLedFilename(name)
    if (names.has(name.toLowerCase())) throw new Error('Support file names must be unique, ignoring case.')
    names.add(name.toLowerCase())
    if (typeof contents !== 'string') throw new Error('Support file contents must be text.')
    bytes += encoder.encode(contents).length
  }
  if (bytes > FASTLED_PROJECT_MAX_BYTES) throw new Error('Project source and support files exceed the 1 MiB limit.')
}

export function parseFastLedProject(text: string): FastLedProject {
  if (new TextEncoder().encode(text).length > 8 * FASTLED_PROJECT_MAX_BYTES) throw new Error('Project file is too large.')
  let input: unknown
  try { input = JSON.parse(text) } catch { throw new Error('Project file must contain valid JSON.') }
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid FastLED project.')
  const value = input as Record<string, unknown>
  if (value.format !== 'pxlblz-fastled' || value.version !== 1) throw new Error('Unsupported FastLED project format or version.')
  if (typeof value.name !== 'string' || !value.name.trim() || value.name.length > 128
    || /[<>:"/\\|?*]/.test(value.name)
    || [...value.name].some((character) => character.charCodeAt(0) < 32)) throw new Error('Project name must be a filename without folders or reserved characters.')
  if (typeof value.source !== 'string') throw new Error('Project source must be text.')
  if (!value.files || typeof value.files !== 'object' || Array.isArray(value.files)) throw new Error('Project files must be a map of filenames to text.')
  const files = value.files as Record<string, string>
  validateFastLedFiles(value.source, files)
  return { format: 'pxlblz-fastled', version: 1, name: value.name, source: value.source, files: { ...files } }
}

export function serializeFastLedProject(project: Omit<FastLedProject, 'format' | 'version'>): string {
  const text = JSON.stringify({ format: 'pxlblz-fastled', version: 1, ...project }, null, 2)
  parseFastLedProject(text)
  return text + '\n'
}
