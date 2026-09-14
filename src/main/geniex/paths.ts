import { accessSync, constants } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { currentGeniexEnv } from './cli'

/**
 * Locates geniex.exe. The Windows installer (Inno Setup) does NOT add it to PATH, so the default location
 * is %LOCALAPPDATA%\GenieX CLI\geniex.exe. Order: explicit override → GENIEX_CLI env → default install dir → PATH.
 */
export function findGenieXCli(override?: string | null): string | null {
  const candidates: string[] = []
  if (override) candidates.push(override)
  if (process.env.GENIEX_CLI) candidates.push(process.env.GENIEX_CLI)
  const localAppData = process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local')
  candidates.push(join(localAppData, 'GenieX CLI', 'geniex.exe'))
  candidates.push(join(localAppData, 'Programs', 'GenieX CLI', 'geniex.exe'))
  candidates.push('C:\\Program Files\\GenieX CLI\\geniex.exe')

  for (const c of candidates) {
    try {
      accessSync(c, constants.X_OK)
      return c
    } catch {
      /* try next */
    }
  }
  // PATH lookup (where.exe on Windows, which elsewhere)
  try {
    const cmd = process.platform === 'win32' ? 'where.exe' : 'which'
    const out = execFileSync(cmd, ['geniex'], { encoding: 'utf8', windowsHide: true, timeout: 4000 })
    const first = out
      .split(/\r?\n/)
      .map((s) => s.trim())
      .find(Boolean)
    if (first) return first
  } catch {
    /* not on PATH */
  }
  return null
}

/** GenieX's model cache root (models/, aihub/, config.json): the Settings override, else GENIEX_DATADIR, else the CLI default. */
export function genieXDataDir(): string {
  return currentGeniexEnv().dataDir ?? process.env.GENIEX_DATADIR ?? join(homedir(), '.cache', 'geniex')
}

export function genieXModelsDir(): string {
  return join(genieXDataDir(), 'models')
}
