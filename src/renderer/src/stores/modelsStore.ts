import { create } from 'zustand'
import type { CachedModel, CatalogueModel, PullJob, PullRequestBody } from '@shared/api'
import { api } from '@/lib/api'

interface ModelsState {
  installed: CachedModel[]
  catalogue: CatalogueModel[]
  pulls: PullJob[]
  loading: boolean
  catalogueLoading: boolean
  error: string | null
  lastLoadedAt: number | null
  refresh(fresh?: boolean): Promise<void>
  loadCatalogue(opts?: { fresh?: boolean; all?: boolean }): Promise<void>
  startPull(req: PullRequestBody): Promise<PullJob>
  cancelPull(id: string): Promise<void>
  clearPulls(): Promise<void>
  remove(name: string): Promise<void>
  setType(name: string, type: 'llm' | 'vlm'): Promise<void>
  subscribePulls(): () => void
  /** Resolve a request id (name[:precision]) to its model info. */
  find(id: string | null | undefined): CachedModel | undefined
}

let pullsSource: EventSource | null = null
let pullsRefs = 0

export const useModelsStore = create<ModelsState>()((set, get) => ({
  installed: [],
  catalogue: [],
  pulls: [],
  loading: false,
  catalogueLoading: false,
  error: null,
  lastLoadedAt: null,

  refresh: async (fresh = false) => {
    set({ loading: true })
    try {
      const res = await api<{ models: CachedModel[]; error?: string }>(`/api/models${fresh ? '?fresh=1' : ''}`, { timeoutMs: 90_000 })
      set({ installed: res.models ?? [], error: res.error ?? null, lastLoadedAt: Date.now() })
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) })
    } finally {
      set({ loading: false })
    }
  },

  loadCatalogue: async (opts = {}) => {
    set({ catalogueLoading: true })
    try {
      const q = new URLSearchParams()
      if (opts.fresh) q.set('fresh', '1')
      if (opts.all) q.set('all', '1')
      const res = await api<{ models: CatalogueModel[] }>(`/api/models/catalogue?${q}`, { timeoutMs: 180_000 })
      set({ catalogue: res.models ?? [] })
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) })
    } finally {
      set({ catalogueLoading: false })
    }
  },

  startPull: async (req) => {
    const res = await api<{ job: PullJob }>('/api/models/pulls', { method: 'POST', json: req })
    set((s) => ({ pulls: [res.job, ...s.pulls.filter((j) => j.id !== res.job.id)] }))
    return res.job
  },

  cancelPull: async (id) => {
    await api(`/api/models/pulls/${id}/cancel`, { method: 'POST' })
  },

  clearPulls: async () => {
    await api('/api/models/pulls/clear', { method: 'POST' })
    set((s) => ({ pulls: s.pulls.filter((j) => j.state === 'running' || j.state === 'queued') }))
  },

  remove: async (name) => {
    await api(`/api/models/${encodeURIComponent(name)}`, { method: 'DELETE', timeoutMs: 120_000 })
    await get().refresh(true)
  },

  setType: async (name, type) => {
    await api('/api/models/set-type', { method: 'POST', json: { name, type } })
    await get().refresh(true)
  },

  subscribePulls: () => {
    pullsRefs++
    if (!pullsSource) {
      pullsSource = new EventSource('/api/models/pulls-events')
      pullsSource.addEventListener('jobs', (e) => {
        try {
          const jobs = JSON.parse((e as MessageEvent).data) as PullJob[]
          const before = get().pulls
          set({ pulls: jobs })
          // Refresh installed list when a job finishes.
          const finishedNow = jobs.some((j) => j.state === 'done' && before.find((b) => b.id === j.id)?.state !== 'done')
          if (finishedNow) void get().refresh(true)
        } catch {
          /* ignore */
        }
      })
      pullsSource.onerror = () => {
        /* EventSource auto-reconnects */
      }
    }
    return () => {
      pullsRefs = Math.max(0, pullsRefs - 1)
      if (pullsRefs === 0 && pullsSource) {
        pullsSource.close()
        pullsSource = null
      }
    }
  },

  find: (id) => {
    if (!id) return undefined
    return get().installed.find((m) => m.requestIds.includes(id) || m.name === id)
  },
}))
