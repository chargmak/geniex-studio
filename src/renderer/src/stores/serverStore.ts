import { create } from 'zustand'
import type { GenieServerStatus, HealthResponse } from '@shared/api'
import { api } from '@/lib/api'

interface ServerState {
  studio: HealthResponse | null
  genie: GenieServerStatus | null
  reachable: boolean
  lastPolledAt: number | null
  polling: boolean
  refresh(): Promise<void>
  startPolling(intervalMs?: number): () => void
  start(): Promise<void>
  stop(): Promise<void>
  restart(): Promise<void>
}

let pollTimer: ReturnType<typeof setInterval> | null = null
let pollRefs = 0

export const useServerStore = create<ServerState>()((set, get) => ({
  studio: null,
  genie: null,
  reachable: false,
  lastPolledAt: null,
  polling: false,

  refresh: async () => {
    try {
      const [studio, genie] = await Promise.all([
        api<HealthResponse>('/api/health', { timeoutMs: 4000 }),
        api<GenieServerStatus>('/api/genie/status', { timeoutMs: 4000 }).catch(() => null),
      ])
      set({ studio, genie, reachable: true, lastPolledAt: Date.now() })
    } catch {
      set({ reachable: false, lastPolledAt: Date.now() })
    }
  },

  startPolling: (intervalMs = 5000) => {
    pollRefs++
    if (!pollTimer) {
      void get().refresh()
      pollTimer = setInterval(() => void get().refresh(), intervalMs)
      set({ polling: true })
    }
    return () => {
      pollRefs = Math.max(0, pollRefs - 1)
      if (pollRefs === 0 && pollTimer) {
        clearInterval(pollTimer)
        pollTimer = null
        set({ polling: false })
      }
    }
  },

  start: async () => {
    await api('/api/genie/start', { method: 'POST' })
    await get().refresh()
  },
  stop: async () => {
    await api('/api/genie/stop', { method: 'POST' })
    await get().refresh()
  },
  restart: async () => {
    await api('/api/genie/restart', { method: 'POST' })
    await get().refresh()
  },
}))
