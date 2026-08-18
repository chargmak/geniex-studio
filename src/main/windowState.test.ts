import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/** One 1920x1080 display at the origin; tests override this to simulate an unplugged monitor. */
let displays = [{ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }]
vi.mock('electron', () => ({ screen: { getAllDisplays: () => displays } }))

const { WindowStateKeeper } = await import('./windowState')

let dir: string
const file = (): string => join(dir, 'window-state.json')
const write = (state: unknown): void => writeFileSync(file(), JSON.stringify(state), 'utf8')

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'geniex-winstate-'))
  displays = [{ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }]
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

/** Minimal BrowserWindow stand-in: only the bits WindowStateKeeper touches. */
class FakeWindow extends EventEmitter {
  constructor(
    private bounds = { x: 100, y: 80, width: 1200, height: 800 },
    private state: { maximized: boolean; minimized: boolean } = { maximized: false, minimized: false },
  ) {
    super()
  }
  isDestroyed = (): boolean => false
  isMinimized = (): boolean => this.state.minimized
  isMaximized = (): boolean => this.state.maximized
  isFullScreen = (): boolean => false
  getNormalBounds = (): { x: number; y: number; width: number; height: number } => this.bounds
  moveTo(x: number, y: number): void {
    this.bounds = { ...this.bounds, x, y }
    this.emit('move')
  }
  maximize(): void {
    this.state.maximized = true
    this.emit('maximize')
  }
}

describe('WindowStateKeeper', () => {
  it('falls back to defaults with no file, and offers no x/y', () => {
    expect(new WindowStateKeeper(dir).bounds).toEqual({ width: 1440, height: 920 })
  })

  it('restores a saved position that is still on a display', () => {
    write({ x: 200, y: 150, width: 1280, height: 860, maximized: true })
    const keeper = new WindowStateKeeper(dir)
    expect(keeper.bounds).toEqual({ x: 200, y: 150, width: 1280, height: 860 })
    expect(keeper.maximized).toBe(true)
  })

  it('drops a position stranded off-screen after a display goes away', () => {
    write({ x: 2400, y: 300, width: 1280, height: 860, maximized: false })
    // The 2nd monitor that made those coordinates valid is gone.
    expect(new WindowStateKeeper(dir).bounds).toEqual({ width: 1280, height: 860 })
  })

  it('keeps a position that is only partly on screen (a normally-dragged window)', () => {
    write({ x: 1800, y: 1000, width: 1280, height: 860, maximized: false })
    expect(new WindowStateKeeper(dir).bounds).toMatchObject({ x: 1800, y: 1000 })
  })

  it('clamps nonsense sizes to the window minimums', () => {
    write({ x: 0, y: 0, width: 10, height: 5, maximized: false })
    expect(new WindowStateKeeper(dir).bounds).toMatchObject({ width: 960, height: 640 })
  })

  it('survives a corrupt state file', () => {
    writeFileSync(file(), '{not json', 'utf8')
    expect(new WindowStateKeeper(dir).bounds).toEqual({ width: 1440, height: 920 })
  })

  it('writes geometry on close and reloads it', () => {
    const keeper = new WindowStateKeeper(dir)
    const win = new FakeWindow()
    keeper.track(win as never)
    win.moveTo(300, 220)
    win.emit('close')
    expect(JSON.parse(readFileSync(file(), 'utf8'))).toMatchObject({ x: 300, y: 220, width: 1200, height: 800, maximized: false })
    expect(new WindowStateKeeper(dir).bounds).toMatchObject({ x: 300, y: 220 })
  })

  it('records maximized without overwriting the restore-down geometry', () => {
    const keeper = new WindowStateKeeper(dir)
    const win = new FakeWindow()
    keeper.track(win as never)
    win.moveTo(300, 220)
    win.maximize()
    win.emit('close')
    const saved = JSON.parse(readFileSync(file(), 'utf8'))
    expect(saved).toMatchObject({ maximized: true, x: 300, y: 220, width: 1200, height: 800 })
  })
})
