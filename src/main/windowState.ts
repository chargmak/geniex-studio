import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { screen, type BrowserWindow, type Rectangle } from 'electron'

export interface WindowState {
  x: number | null
  y: number | null
  width: number
  height: number
  maximized: boolean
}

const DEFAULT_STATE: WindowState = { x: null, y: null, width: 1440, height: 920, maximized: false }

/**
 * Remembers window size/position across launches, the way a normal desktop app does.
 * Saved to `<userData>/window-state.json` (debounced) and validated against the displays that exist *now*,
 * so unplugging a monitor cannot strand the window off-screen.
 */
export class WindowStateKeeper {
  readonly file: string
  private state: WindowState
  private saveTimer: NodeJS.Timeout | null = null

  constructor(dataDir: string) {
    this.file = join(dataDir, 'window-state.json')
    this.state = this.load()
  }

  /** BrowserWindow constructor options for the remembered geometry. */
  get bounds(): { width: number; height: number; x?: number; y?: number } {
    const { x, y, width, height } = this.state
    return x === null || y === null ? { width, height } : { width, height, x, y }
  }

  get maximized(): boolean {
    return this.state.maximized
  }

  /**
   * Attach to a window and track moves/resizes. Restoring the maximized state is left to the caller
   * (`win.maximize()` also shows the window, which would defeat a start-hidden launch).
   */
  track(win: BrowserWindow): void {
    const onChange = (): void => {
      if (win.isDestroyed()) return
      // Only record normal-mode geometry, so un-maximising later restores a sane size.
      if (!win.isMaximized() && !win.isMinimized() && !win.isFullScreen()) {
        const b = win.getNormalBounds()
        this.state = { ...this.state, x: b.x, y: b.y, width: b.width, height: b.height }
      }
      this.state.maximized = win.isMaximized()
      this.scheduleSave()
    }
    win.on('resize', onChange)
    win.on('move', onChange)
    win.on('maximize', onChange)
    win.on('unmaximize', onChange)
    win.on('close', () => {
      onChange()
      this.save()
    })
  }

  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => this.save(), 500)
  }

  private save(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = null
    try {
      mkdirSync(dirname(this.file), { recursive: true })
      const tmp = `${this.file}.tmp`
      writeFileSync(tmp, JSON.stringify(this.state, null, 2), 'utf8')
      renameSync(tmp, this.file)
    } catch {
      /* window geometry is not worth failing a launch over */
    }
  }

  private load(): WindowState {
    let raw: Partial<WindowState> = {}
    try {
      if (existsSync(this.file)) raw = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<WindowState>
    } catch {
      /* fall through to defaults */
    }
    const state: WindowState = {
      x: numberOrNull(raw.x),
      y: numberOrNull(raw.y),
      width: clamp(raw.width, 960, 20_000, DEFAULT_STATE.width),
      height: clamp(raw.height, 640, 20_000, DEFAULT_STATE.height),
      maximized: raw.maximized === true,
    }
    if (state.x !== null && state.y !== null && !isVisibleOnSomeDisplay({ x: state.x, y: state.y, width: state.width, height: state.height })) {
      state.x = null
      state.y = null
    }
    return state
  }
}

function numberOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null
}

function clamp(v: unknown, min: number, max: number, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : fallback
}

/** True when a decent slice of the title bar lands inside some display's work area. */
function isVisibleOnSomeDisplay(bounds: Rectangle): boolean {
  return screen.getAllDisplays().some(({ workArea: a }) => {
    const overlapX = Math.min(bounds.x + bounds.width, a.x + a.width) - Math.max(bounds.x, a.x)
    const overlapY = Math.min(bounds.y + bounds.height, a.y + a.height) - Math.max(bounds.y, a.y)
    return overlapX >= 120 && overlapY >= 40
  })
}
