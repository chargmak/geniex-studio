/**
 * Everything long-lived that HTTP routes need. Constructed once at boot (Electron main or the headless runner)
 * and threaded through Hono via `c.get('ctx')`.
 */
export interface AppContext {
  /** 'electron' when running inside the desktop shell, 'headless' for `npm run serve` / --headless. */
  mode: 'electron' | 'headless'
  version: string
  startedAt: number
  /** Absolute path of the writable per-user data directory (Electron userData or ~/.geniex-studio). */
  dataDir: string
  /** Absolute path to the built renderer (out/renderer); undefined in dev when Vite serves it. */
  rendererDir?: string
}

declare module 'hono' {
  interface ContextVariableMap {
    ctx: AppContext
  }
}
