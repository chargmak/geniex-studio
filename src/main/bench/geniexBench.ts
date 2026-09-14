import { execFile } from 'node:child_process'
import { createWriteStream, promises as fs } from 'node:fs'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import type { BenchResult, BenchRunRequest, BenchStatus } from '@shared/api'
import type { GenieXSupervisor } from '../geniex/supervisor'
import { currentGeniexEnv } from '../geniex/cli'
import { runtimeOfModel } from '@shared/modelSelect'

/** Qualcomm's standalone benchmark (llama-bench-style medians over N runs). Same release line as the CLI. */
const BENCH_URL = 'https://qaihub-public-assets.s3.us-west-2.amazonaws.com/qai-hub-geniex/geniex-bench-windows-arm64.zip'

interface AggStat {
  median?: number
  min?: number
  max?: number
  mean?: number
  stdev?: number
}

interface BenchJson {
  schema_version?: number
  plugin?: string
  device?: string
  device_id?: string
  model_path?: string
  qairt_version?: string
  llama_cpp_version?: string
  agg?: { ttft_ms?: AggStat; prefill_tps?: AggStat; decode_tps?: AggStat; gen_tokens?: AggStat; prompt_tokens?: AggStat; media_ms?: AggStat }
}

/**
 * Installs and runs `geniex-bench` under the Studio data directory. The tool reuses the CLI's model cache when
 * given a model-manager id (`org/repo[:quant]`), so nothing is downloaded twice.
 */
export class GenieXBench {
  private readonly root: string
  private running: { model: string; startedAt: number } | null = null
  private installing: Promise<BenchStatus> | null = null

  constructor(
    dataDir: string,
    private readonly sup: GenieXSupervisor,
  ) {
    this.root = join(dataDir, 'bench')
  }

  private async locate(): Promise<{ exe: string; version: string | null } | null> {
    try {
      const entries = await fs.readdir(this.root, { withFileTypes: true })
      for (const e of entries) {
        if (!e.isDirectory()) continue
        const exe = join(this.root, e.name, 'bin', 'geniex-bench.exe')
        try {
          await fs.access(exe)
          const v = e.name.match(/v\d+\.\d+\.\d+[\w.-]*/)?.[0] ?? null
          return { exe, version: v }
        } catch {
          /* next */
        }
      }
    } catch {
      /* not installed */
    }
    return null
  }

  async status(): Promise<BenchStatus> {
    const found = await this.locate()
    return { installed: !!found, version: found?.version ?? null, path: found?.exe ?? null, downloadUrl: BENCH_URL, running: this.running, installing: !!this.installing }
  }

  /** Downloads the ~85 MB zip and extracts it. Idempotent; concurrent calls share one download. */
  install(): Promise<BenchStatus> {
    if (this.installing) return this.installing
    this.installing = this.doInstall().finally(() => {
      this.installing = null
    })
    return this.installing
  }

  private async doInstall(): Promise<BenchStatus> {
    await fs.mkdir(this.root, { recursive: true })
    const zip = join(this.root, 'geniex-bench.zip')
    const res = await fetch(BENCH_URL, { signal: AbortSignal.timeout(10 * 60_000) })
    if (!res.ok || !res.body) throw new Error(`download failed: HTTP ${res.status}`)
    await pipeline(Readable.fromWeb(res.body as import('node:stream/web').ReadableStream), createWriteStream(zip))
    this.sup.log('studio', `geniex-bench downloaded (${Math.round((await fs.stat(zip)).size / 1e6)} MB); extracting…`)
    await new Promise<void>((resolve, reject) => {
      execFile(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', `Expand-Archive -LiteralPath '${zip.replace(/'/g, "''")}' -DestinationPath '${this.root.replace(/'/g, "''")}' -Force`],
        { windowsHide: true, timeout: 5 * 60_000 },
        (err, _out, stderr) => (err ? reject(new Error(`extract failed: ${stderr || err.message}`)) : resolve()),
      )
    })
    await fs.rm(zip, { force: true }).catch(() => {})
    const st = await this.status()
    if (!st.installed) throw new Error('geniex-bench.exe not found after extraction')
    this.sup.log('studio', `geniex-bench ${st.version ?? ''} installed at ${st.path}`)
    return st
  }

  async run(req: BenchRunRequest): Promise<BenchResult> {
    const found = await this.locate()
    if (!found) throw new Error('geniex-bench is not installed')
    if (this.running) throw new Error(`a benchmark of ${this.running.model} is already running`)
    const runtime = runtimeOfModel(req.model)
    const device = runtime === 'qairt' ? 'npu' : (req.device ?? 'npu')
    const out = join(this.root, `result-${Date.now()}.json`)
    const args = [
      '--plugin',
      runtime,
      '--device',
      device,
      '-m',
      req.model,
      '-p',
      String(req.promptTokens ?? 512),
      '-n',
      String(req.genTokens ?? 128),
      '-r',
      String(req.repetitions ?? 5),
      '--warmup',
      '1',
      '--output-json',
      out,
    ]
    if (req.specType && runtime === 'llama_cpp') args.push('--spec-type', req.specType)
    this.running = { model: req.model, startedAt: Date.now() }
    this.sup.log('studio', `geniex-bench ${args.join(' ')}`)
    const env = { ...process.env, NO_COLOR: '1', ...(currentGeniexEnv().dataDir ? { GENIEX_DATADIR: currentGeniexEnv().dataDir! } : {}), ...(currentGeniexEnv().qairtLib ? { GENIEX_QAIRT_LIB: currentGeniexEnv().qairtLib! } : {}) }
    const started = Date.now()
    try {
      const { stdout, stderr, code } = await new Promise<{ stdout: string; stderr: string; code: number | null }>((resolve) => {
        execFile(found.exe, args, { windowsHide: true, timeout: 20 * 60_000, maxBuffer: 32 * 1024 * 1024, env, encoding: 'utf8' }, (err, stdout, stderr) => {
          resolve({ stdout: String(stdout ?? ''), stderr: String(stderr ?? ''), code: err ? ((err as { code?: number }).code ?? 1) : 0 })
        })
      })
      let json: BenchJson | null = null
      try {
        json = JSON.parse(await fs.readFile(out, 'utf8')) as BenchJson
      } catch {
        json = null
      }
      await fs.rm(out, { force: true }).catch(() => {})
      const summary = (stdout + '\n' + stderr).split(/\r?\n/).find((l) => /^\[ok\s*\]/.test(l)) ?? null
      const errorLine = (stdout + '\n' + stderr)
        .split(/\r?\n/)
        .filter((l) => /\[(err|fail|error)/i.test(l) || /^error/i.test(l))
        .slice(-1)[0]
      if (!json?.agg) throw new Error(errorLine?.replace(/\[[0-9;]*m/g, '') || `geniex-bench exited with code ${code ?? '?'}`)
      const pick = (s?: AggStat): BenchResult['ttftMs'] => ({ median: s?.median ?? null, min: s?.min ?? null, max: s?.max ?? null, mean: s?.mean ?? null, stdev: s?.stdev ?? null })
      return {
        model: req.model,
        runtime,
        device: json.device_id ?? json.device ?? device,
        specType: req.specType ?? null,
        promptTokens: json.agg.prompt_tokens?.median ?? req.promptTokens ?? 512,
        genTokens: json.agg.gen_tokens?.median ?? req.genTokens ?? 128,
        repetitions: req.repetitions ?? 5,
        ttftMs: pick(json.agg.ttft_ms),
        prefillTps: pick(json.agg.prefill_tps),
        decodeTps: pick(json.agg.decode_tps),
        benchVersion: found.version,
        llamaCppVersion: json.llama_cpp_version ?? null,
        qairtVersion: json.qairt_version ?? null,
        summaryLine: summary?.replace(/\[[0-9;]*m/g, '') ?? null,
        wallMs: Date.now() - started,
        at: Date.now(),
      }
    } finally {
      this.running = null
    }
  }
}
