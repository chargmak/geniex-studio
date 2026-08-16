import { create } from 'zustand'
import type { KnowledgeHit, KnowledgeSource } from '@shared/sidecar'
import { api } from '@/lib/api'

export interface KnowledgeProgress {
  sourceId: string
  phase: 'scanning' | 'embedding' | 'ready' | 'error'
  files: number
  chunks: number
  done: number
  message?: string
}

interface KnowledgeState {
  sources: KnowledgeSource[]
  ready: boolean
  progress: Record<string, KnowledgeProgress>
  loaded: boolean
  error: string | null
  searching: boolean
  results: { query: string; hits: KnowledgeHit[]; durationMs: number } | null

  refresh: () => Promise<void>
  addSource: (path: string, name?: string) => Promise<KnowledgeSource>
  removeSource: (id: string) => Promise<void>
  reindex: (id: string) => Promise<void>
  search: (query: string, topK?: number) => Promise<void>
  subscribe: () => () => void
}

let es: EventSource | null = null

export const useKnowledgeStore = create<KnowledgeState>((set, get) => ({
  sources: [],
  ready: false,
  progress: {},
  loaded: false,
  error: null,
  searching: false,
  results: null,

  refresh: async () => {
    try {
      const r = await api<{ sources: KnowledgeSource[]; ready: boolean }>('/api/knowledge/sources')
      set({ sources: r.sources, ready: r.ready, loaded: true, error: null })
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err), loaded: true })
    }
  },

  addSource: async (path, name) => {
    const r = await api<{ source: KnowledgeSource }>('/api/knowledge/sources', { method: 'POST', json: { path, name } })
    set((s) => ({ sources: [r.source, ...s.sources.filter((x) => x.id !== r.source.id)] }))
    return r.source
  },

  removeSource: async (id) => {
    await api(`/api/knowledge/sources/${id}`, { method: 'DELETE' })
    set((s) => ({ sources: s.sources.filter((x) => x.id !== id), ready: s.sources.some((x) => x.id !== id && x.status === 'ready' && x.chunks > 0) }))
  },

  reindex: async (id) => {
    await api(`/api/knowledge/sources/${id}/reindex`, { method: 'POST' })
  },

  search: async (query, topK = 6) => {
    set({ searching: true })
    try {
      const r = await api<{ hits: KnowledgeHit[]; durationMs: number }>('/api/knowledge/search', { method: 'POST', json: { query, topK } })
      set({ results: { query, hits: r.hits, durationMs: r.durationMs }, searching: false, error: null })
    } catch (err) {
      set({ searching: false, error: err instanceof Error ? err.message : String(err) })
    }
  },

  subscribe: () => {
    if (es) return () => {}
    es = new EventSource('/api/knowledge/events')
    es.addEventListener('source', (ev) => {
      const src = JSON.parse((ev as MessageEvent).data) as KnowledgeSource
      set((s) => {
        const sources = s.sources.some((x) => x.id === src.id) ? s.sources.map((x) => (x.id === src.id ? src : x)) : [src, ...s.sources]
        return { sources, ready: sources.some((x) => x.status === 'ready' && x.chunks > 0) }
      })
    })
    es.addEventListener('progress', (ev) => {
      const p = JSON.parse((ev as MessageEvent).data) as KnowledgeProgress
      set((s) => ({ progress: { ...s.progress, [p.sourceId]: p } }))
    })
    es.onerror = () => {
      /* EventSource auto-reconnects */
    }
    void get().refresh()
    return () => {
      es?.close()
      es = null
    }
  },
}))
