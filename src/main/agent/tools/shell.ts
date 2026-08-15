import { spawn } from 'node:child_process'
import { killTree } from '../../util/killTree'
import { clip, type Tool } from './types'

const MAX_OUTPUT = 40_000

export const runCommandTool: Tool = {
  name: 'run_command',
  family: 'shell',
  risk: 'exec',
  description:
    'Run a PowerShell command in the workspace folder and return its output (stdout+stderr) and exit code. Non-interactive only; commands time out after `timeout_seconds` (default 120). Use for builds, tests, git, listing processes, etc.',
  parameters: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'PowerShell command line to run' },
      timeout_seconds: { type: 'integer', description: 'Kill after this many seconds (default 120, max 900)' },
    },
    required: ['command'],
  },
  summarize: (a) => `Run: ${String(a.command ?? '').slice(0, 160)}`,
  needsApproval: () => true,
  async run(a, rc) {
    const command = String(a.command ?? '').trim()
    if (!command) return { ok: false, content: 'command is empty.' }
    const timeoutMs = Math.max(1, Math.min(900, Number(a.timeout_seconds ?? 120))) * 1000
    const started = Date.now()
    const shell = process.platform === 'win32' ? 'powershell.exe' : '/bin/sh'
    const args = process.platform === 'win32' ? ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command] : ['-c', command]
    const child = spawn(shell, args, { cwd: rc.workspaceRoot, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, NO_COLOR: '1', TERM: 'dumb', GIT_TERMINAL_PROMPT: '0' } })
    let out = ''
    let truncated = false
    const push = (chunk: string): void => {
      if (out.length < MAX_OUTPUT) {
        out += chunk
        rc.onOutput?.(chunk)
      } else truncated = true
    }
    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', push)
    child.stderr?.on('data', push)

    const onAbort = (): void => void killTree(child)
    rc.signal.addEventListener('abort', onAbort, { once: true })
    const timer = setTimeout(() => void killTree(child), timeoutMs)
    const code: number | null = await new Promise((resolve) => {
      child.on('error', (err) => {
        push(`\n[spawn error] ${err.message}`)
        resolve(-1)
      })
      child.on('exit', (c) => resolve(c))
    })
    clearTimeout(timer)
    rc.signal.removeEventListener('abort', onAbort)
    const durationMs = Date.now() - started
    const timedOut = durationMs >= timeoutMs - 5 && code !== 0
    const cancelled = rc.signal.aborted
    const status = cancelled ? 'cancelled' : timedOut ? `timed out after ${Math.round(timeoutMs / 1000)}s` : `exit code ${code ?? '?'}`
    const body = `${clip(out.trim() || '(no output)', MAX_OUTPUT)}${truncated ? '\n…[output truncated]' : ''}\n\n[${status}, ${durationMs} ms]`
    return { ok: code === 0 && !timedOut && !cancelled, content: body, meta: { exitCode: code, durationMs, timedOut, cancelled } }
  },
}

export const shellTools: Tool[] = [runCommandTool]
