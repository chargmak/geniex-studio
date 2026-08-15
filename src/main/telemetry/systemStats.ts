import { execFile } from 'node:child_process'
import { cpus, freemem, totalmem } from 'node:os'

export interface SystemStats {
  ts: number
  cpuPercent: number | null
  memUsedBytes: number
  memTotalBytes: number
  npuPercent: number | null
  npuCounterName: string | null
  gpuPercent: number | null
  geniex: { pid: number; workingSetBytes: number; cpuSeconds: number } | null
  cores: number
}

let npuCounterPath: string | null | undefined // undefined = not probed yet
let lastCpu: { idle: number; total: number } | null = null

function cpuSnapshot(): { idle: number; total: number } {
  let idle = 0
  let total = 0
  for (const c of cpus()) {
    idle += c.times.idle
    total += c.times.user + c.times.nice + c.times.sys + c.times.irq + c.times.idle
  }
  return { idle, total }
}

function ps(command: string, timeoutMs = 8000): Promise<string> {
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { windowsHide: true, timeout: timeoutMs, encoding: 'utf8' }, (err, stdout) => resolve(err ? '' : String(stdout)))
  })
}

/**
 * Discover an NPU utilisation counter once. Windows 11 exposes "NPU Engine" counters (like "GPU Engine") on
 * machines with an NPU driver that reports them; names vary, so probe with -ListSet and remember the result.
 */
async function discoverNpuCounter(): Promise<string | null> {
  if (process.platform !== 'win32') return null
  const out = await ps(`(Get-Counter -ListSet '*NPU*' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Paths) -join "\`n"`, 15_000)
  const paths = out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const util = paths.find((p) => /utili[sz]ation/i.test(p) && /engine/i.test(p)) ?? paths.find((p) => /utili[sz]ation/i.test(p)) ?? null
  return util
}

async function sampleNpu(): Promise<{ percent: number | null; name: string | null }> {
  if (npuCounterPath === undefined) npuCounterPath = await discoverNpuCounter()
  if (!npuCounterPath) return { percent: null, name: null }
  // Sum all engine instances (path may contain a wildcard).
  const out = await ps(`$s = Get-Counter -Counter '${npuCounterPath.replace(/'/g, "''")}' -ErrorAction SilentlyContinue; if ($s) { ($s.CounterSamples | Measure-Object -Property CookedValue -Sum).Sum }`, 8000)
  const v = Number(out.trim())
  return { percent: Number.isFinite(v) ? Math.min(100, v) : null, name: npuCounterPath }
}

async function sampleGpu(): Promise<number | null> {
  if (process.platform !== 'win32') return null
  const out = await ps(`$s = Get-Counter -Counter '\\GPU Engine(*engtype_3D)\\Utilization Percentage' -ErrorAction SilentlyContinue; if ($s) { ($s.CounterSamples | Measure-Object -Property CookedValue -Sum).Sum }`, 8000)
  const v = Number(out.trim())
  return Number.isFinite(v) ? Math.min(100, v) : null
}

async function sampleGeniex(pid: number | null): Promise<SystemStats['geniex']> {
  if (!pid || process.platform !== 'win32') return null
  const out = await ps(`$p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue; if ($p) { "$($p.WorkingSet64)|$($p.CPU)" }`, 5000)
  const [ws, cpu] = out.trim().split('|')
  if (!ws) return null
  return { pid, workingSetBytes: Number(ws) || 0, cpuSeconds: Number(cpu) || 0 }
}

/** One sample of system utilisation. Perf-counter reads take ~1s each on Windows; call at most every few seconds. */
export async function sampleSystem(geniexPid: number | null, opts: { npu?: boolean; gpu?: boolean } = {}): Promise<SystemStats> {
  const now = cpuSnapshot()
  let cpuPercent: number | null = null
  if (lastCpu) {
    const dIdle = now.idle - lastCpu.idle
    const dTotal = now.total - lastCpu.total
    cpuPercent = dTotal > 0 ? Math.max(0, Math.min(100, (1 - dIdle / dTotal) * 100)) : null
  }
  lastCpu = now
  const [npu, gpu, geniex] = await Promise.all([opts.npu === false ? { percent: null, name: null } : sampleNpu(), opts.gpu === false ? null : sampleGpu(), sampleGeniex(geniexPid)])
  return {
    ts: Date.now(),
    cpuPercent,
    memUsedBytes: totalmem() - freemem(),
    memTotalBytes: totalmem(),
    npuPercent: npu.percent,
    npuCounterName: npu.name,
    gpuPercent: gpu,
    geniex,
    cores: cpus().length,
  }
}
