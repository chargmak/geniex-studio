import { execFile } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'

/**
 * Kill a process and its children. On Windows a plain child.kill() leaves grandchildren (e.g. helper processes
 * spawned by geniex) alive, so use taskkill /T /F. Elsewhere send SIGTERM then SIGKILL after a grace period.
 */
export async function killTree(child: ChildProcess, graceMs = 3000): Promise<void> {
  const pid = child.pid
  if (!pid || child.exitCode !== null || child.signalCode !== null) return
  if (process.platform === 'win32') {
    await new Promise<void>((resolve) => {
      execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => resolve())
    })
    return
  }
  try {
    child.kill('SIGTERM')
  } catch {
    /* ignore */
  }
  await new Promise<void>((resolve) => {
    const t = setTimeout(() => {
      try {
        child.kill('SIGKILL')
      } catch {
        /* ignore */
      }
      resolve()
    }, graceMs)
    child.once('exit', () => {
      clearTimeout(t)
      resolve()
    })
  })
}

export function killPidTree(pid: number): Promise<void> {
  return new Promise<void>((resolve) => {
    if (process.platform === 'win32') {
      execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => resolve())
    } else {
      try {
        process.kill(pid, 'SIGTERM')
      } catch {
        /* ignore */
      }
      resolve()
    }
  })
}
