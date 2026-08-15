import type { ComputeUnit } from './config'
import type { SamplerSettings } from './api'
import { DEFAULT_GENIEX_HOST, DEFAULT_GENIEX_KEEPALIVE_SECONDS, DEFAULT_NCTX } from './config'

/** Persisted Studio settings (dataDir/settings.json). Renderer edits via /api/settings. */
export interface StudioSettings {
  genie: {
    /** Explicit geniex.exe path; null = auto-detect. */
    cliPath: string | null
    host: string
    keepaliveSeconds: number
    nctx: number
    ngl: number
    /** Server-wide default compute; null lets GenieX pick (npu). Per-request compute overrides this. */
    compute: ComputeUnit | null
    origins: string
    logLevel: 'none' | 'error' | 'warn' | 'info' | 'debug' | 'trace'
    autoStart: boolean
    /** Attach to an already running server on `host` instead of failing. */
    attachExisting: boolean
  }
  defaults: {
    /** Preferred model id for new chats (null = first installed). */
    chatModel: string | null
    visionModel: string | null
    agentModel: string | null
    sampler: Required<Pick<SamplerSettings, 'temperature' | 'top_p' | 'max_tokens'>> & SamplerSettings
    enableThink: boolean
    /** GGUF compute unit. 'npu' (pinned Hexagon) is the reliable default on X Elite; 'hybrid' is faster per docs but crashed on 4B models here. QAIRT ignores this. */
    computeGguf: ComputeUnit
    systemPrompt: string
    keepCache: boolean
  }
  workspace: {
    root: string | null
  }
  agent: {
    maxTurns: number
    /** Tool risks that never prompt (default: read-only + network). */
    autoApproveRisks: ('read' | 'write' | 'exec' | 'network' | 'mcp')[]
    enabledFamilies: ('fs' | 'shell' | 'web' | 'mcp' | 'vision')[]
    /** Extra instructions appended to the agent system prompt. */
    instructions: string
  }
  ui: {
    theme: 'dark' | 'light'
    closeToTray: boolean
    launchAtLogin: boolean
  }
  onboarding: {
    completed: boolean
  }
}

export const DEFAULT_SETTINGS: StudioSettings = {
  genie: {
    cliPath: null,
    host: DEFAULT_GENIEX_HOST,
    keepaliveSeconds: DEFAULT_GENIEX_KEEPALIVE_SECONDS,
    nctx: DEFAULT_NCTX,
    ngl: -1,
    compute: null,
    origins: '*',
    logLevel: 'info',
    autoStart: true,
    attachExisting: true,
  },
  defaults: {
    chatModel: null,
    visionModel: null,
    agentModel: null,
    sampler: { temperature: 0.7, top_p: 0.9, max_tokens: 2048 },
    enableThink: true,
    computeGguf: 'npu',
    systemPrompt: 'You are a helpful, precise assistant running locally on this device.',
    keepCache: true,
  },
  workspace: { root: null },
  agent: {
    maxTurns: 12,
    autoApproveRisks: ['read', 'network'],
    enabledFamilies: ['fs', 'shell', 'web', 'mcp', 'vision'],
    instructions: '',
  },
  ui: { theme: 'dark', closeToTray: true, launchAtLogin: false },
  onboarding: { completed: false },
}

/** Deep-merge helper for partial patches (arrays/values replaced, objects merged). */
export function mergeSettings<T>(base: T, patch: unknown): T {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return base
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) }
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    const cur = out[k]
    if (v && typeof v === 'object' && !Array.isArray(v) && cur && typeof cur === 'object' && !Array.isArray(cur)) {
      out[k] = mergeSettings(cur, v)
    } else if (v !== undefined) {
      out[k] = v
    }
  }
  return out as T
}
