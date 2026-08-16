import { create } from 'zustand'
import type { Generation, ImageGenerationRequest, ProvisionEvent, SidecarStatus, TranscriptionResult } from '@shared/sidecar'
import { api, readSse } from '@/lib/api'

interface SidecarState {
  status: SidecarStatus | null
  provisionLog: string[]
  provisionStep: string | null
  provisioning: boolean
  generations: Generation[]
  generating: boolean
  lastError: string | null
  downloads: Record<string, { progress: number | null; message: string; done: boolean; error: string | null }>
  refresh(): Promise<void>
  provision(): Promise<void>
  start(): Promise<void>
  stop(): Promise<void>
  loadGenerations(): Promise<void>
  generate(req: ImageGenerationRequest): Promise<Generation[]>
  deleteGeneration(id: string): Promise<void>
  downloadModel(id: string): Promise<void>
  transcribe(blob: Blob, opts?: { language?: string; model?: string }): Promise<TranscriptionResult>
  speak(text: string, voice?: string): Promise<Blob>
  subscribe(): () => void
}

let events: EventSource | null = null
let refs = 0

export const useSidecarStore = create<SidecarState>()((set, get) => ({
  status: null,
  provisionLog: [],
  provisionStep: null,
  provisioning: false,
  generations: [],
  generating: false,
  lastError: null,
  downloads: {},

  refresh: async () => {
    try {
      set({ status: await api<SidecarStatus>('/api/sidecar/status', { timeoutMs: 8000 }) })
    } catch {
      /* studio offline */
    }
  },

  provision: async () => {
    set({ provisioning: true, provisionLog: [], provisionStep: 'Starting…', lastError: null })
    try {
      const res = await fetch('/api/sidecar/provision', { method: 'POST' })
      for await (const ev of readSse<ProvisionEvent>(res)) {
        if (ev.type === 'step') set((s) => ({ provisionStep: ev.message ?? ev.step ?? null, provisionLog: [...s.provisionLog, `▶ ${ev.message ?? ev.step}`].slice(-400) }))
        else if (ev.type === 'log') set((s) => ({ provisionLog: [...s.provisionLog, ev.message ?? ''].slice(-400) }))
        else if (ev.type === 'done') set((s) => ({ provisionStep: ev.message ?? 'Done', provisionLog: [...s.provisionLog, `✓ ${ev.message ?? 'Done'}`] }))
        else if (ev.type === 'error') set((s) => ({ lastError: ev.message ?? 'Install failed', provisionLog: [...s.provisionLog, `✗ ${ev.message}`] }))
      }
    } catch (err) {
      set({ lastError: err instanceof Error ? err.message : String(err) })
    } finally {
      set({ provisioning: false })
      await get().refresh()
    }
  },

  start: async () => {
    set({ lastError: null })
    try {
      set({ status: await api<SidecarStatus>('/api/sidecar/start', { method: 'POST', timeoutMs: 120_000 }) })
    } catch (err) {
      set({ lastError: err instanceof Error ? err.message : String(err) })
      await get().refresh()
    }
  },
  stop: async () => {
    set({ status: await api<SidecarStatus>('/api/sidecar/stop', { method: 'POST' }) })
  },

  loadGenerations: async () => {
    try {
      const r = await api<{ generations: Generation[] }>('/api/sidecar/generations')
      set({ generations: r.generations })
    } catch {
      /* ignore */
    }
  },

  generate: async (req) => {
    set({ generating: true, lastError: null })
    try {
      const r = await api<{ generations: Generation[] }>('/api/sidecar/images/generations', { method: 'POST', json: req, timeoutMs: 20 * 60_000 })
      set((s) => ({ generations: [...r.generations, ...s.generations] }))
      return r.generations
    } catch (err) {
      set({ lastError: err instanceof Error ? err.message : String(err) })
      throw err
    } finally {
      set({ generating: false })
      void get().refresh()
    }
  },

  deleteGeneration: async (id) => {
    await api(`/api/sidecar/generations/${id}`, { method: 'DELETE' })
    set((s) => ({ generations: s.generations.filter((g) => g.id !== id) }))
  },

  downloadModel: async (id) => {
    set((s) => ({ downloads: { ...s.downloads, [id]: { progress: null, message: 'Starting…', done: false, error: null } } }))
    try {
      const res = await fetch(`/api/sidecar/models/${encodeURIComponent(id)}/download`, { method: 'POST' })
      for await (const ev of readSse<{ type?: string; progress?: number; message?: string; error?: string; downloaded?: number; total?: number }>(res)) {
        set((s) => ({
          downloads: {
            ...s.downloads,
            [id]: {
              progress: ev.progress ?? (ev.total ? (ev.downloaded ?? 0) / ev.total : (s.downloads[id]?.progress ?? null)),
              message: ev.message ?? ev.error ?? s.downloads[id]?.message ?? '',
              done: ev.type === 'done',
              error: ev.type === 'error' ? (ev.message ?? ev.error ?? 'download failed') : null,
            },
          },
        }))
      }
    } catch (err) {
      set((s) => ({ downloads: { ...s.downloads, [id]: { progress: null, message: '', done: false, error: err instanceof Error ? err.message : String(err) } } }))
    } finally {
      await get().refresh()
    }
  },

  transcribe: async (blob, opts = {}) => {
    const fd = new FormData()
    fd.set('file', blob, 'audio.wav')
    if (opts.language) fd.set('language', opts.language)
    if (opts.model) fd.set('model', opts.model)
    const res = await fetch('/api/sidecar/audio/transcriptions', { method: 'POST', body: fd })
    const json = (await res.json()) as TranscriptionResult & { error?: string }
    if (!res.ok || json.error) throw new Error(json.error ?? `HTTP ${res.status}`)
    return json
  },

  speak: async (text, voice) => {
    const res = await fetch('/api/sidecar/audio/speech', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ input: text, voice }) })
    if (!res.ok) throw new Error((await res.json().catch(() => ({ error: res.statusText }))).error ?? res.statusText)
    return await res.blob()
  },

  subscribe: () => {
    refs++
    if (!events) {
      void get().refresh()
      events = new EventSource('/api/sidecar/events')
      events.addEventListener('status', (e) => set({ status: JSON.parse((e as MessageEvent).data) as SidecarStatus }))
    }
    return () => {
      refs = Math.max(0, refs - 1)
      if (refs === 0 && events) {
        events.close()
        events = null
      }
    }
  },
}))
