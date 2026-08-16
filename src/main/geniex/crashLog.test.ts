import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CrashLog } from './crashLog'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'geniex-crashlog-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('CrashLog', () => {
  it('starts empty and does not create a file until something is recorded', () => {
    const log = new CrashLog(dir)
    expect(log.all()).toEqual({})
    expect(() => readFileSync(join(dir, 'runtime-crashes.json'))).toThrow()
  })

  it('persists a crash and reloads it in a new instance (the whole point)', () => {
    new CrashLog(dir).record('qualcomm/Qwen3-0.6B', '0xC0000005')
    const reloaded = new CrashLog(dir)
    expect(reloaded.get('qualcomm/Qwen3-0.6B')).toMatchObject({ count: 1, code: '0xC0000005' })
  })

  it('increments the count on repeat crashes', () => {
    const log = new CrashLog(dir)
    log.record('m', 'x')
    log.record('m', 'y')
    expect(new CrashLog(dir).get('m')).toMatchObject({ count: 2, code: 'y' })
  })

  it('constructing an instance never rewrites existing history', () => {
    const file = join(dir, 'runtime-crashes.json')
    const seeded = { 'qualcomm/Qwen3-0.6B': { count: 1, lastAt: 1700000000000, code: '0xC0000005' } }
    writeFileSync(file, JSON.stringify(seeded), 'utf8')
    for (let i = 0; i < 3; i++) new CrashLog(dir)
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(seeded)
  })

  it('clears one model or all of them', () => {
    const log = new CrashLog(dir)
    log.record('a', '1')
    log.record('b', '2')
    log.clear('a')
    expect(new CrashLog(dir).all()).toEqual({ b: expect.objectContaining({ code: '2' }) })
    log.clear()
    expect(new CrashLog(dir).all()).toEqual({})
  })

  it('survives a corrupt or malformed file without throwing', () => {
    const file = join(dir, 'runtime-crashes.json')
    writeFileSync(file, '{ not json', 'utf8')
    expect(new CrashLog(dir).all()).toEqual({})
    writeFileSync(file, '[1,2,3]', 'utf8')
    expect(new CrashLog(dir).all()).toEqual({})
    writeFileSync(file, '{"m":{"count":"nope"}}', 'utf8')
    expect(new CrashLog(dir).all()).toEqual({})
  })
})
