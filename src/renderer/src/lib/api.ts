import type { ApiError } from '@shared/api'

export class HttpError extends Error {
  status: number
  code?: string | number
  details?: unknown
  constructor(status: number, message: string, code?: string | number, details?: unknown) {
    super(message)
    this.name = 'HttpError'
    this.status = status
    this.code = code
    this.details = details
  }
}

/** Same-origin JSON fetch with normalized errors. */
export async function api<T>(path: string, init?: RequestInit & { json?: unknown; timeoutMs?: number }): Promise<T> {
  const { json, timeoutMs, ...rest } = init ?? {}
  const controller = new AbortController()
  const timer = timeoutMs ? setTimeout(() => controller.abort(), timeoutMs) : null
  const signal = rest.signal ? AbortSignal.any([rest.signal, controller.signal]) : controller.signal
  try {
    const res = await fetch(path, {
      ...rest,
      signal,
      headers: {
        Accept: 'application/json',
        ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(rest.headers ?? {}),
      },
      body: json !== undefined ? JSON.stringify(json) : rest.body,
    })
    const text = await res.text()
    let data: unknown = null
    if (text) {
      try {
        data = JSON.parse(text)
      } catch {
        data = text
      }
    }
    if (!res.ok) {
      const err = typeof data === 'object' && data ? (data as ApiError) : null
      const message = err?.error ?? (typeof data === 'string' && data ? data : res.statusText)
      throw new HttpError(res.status, message, err?.code, err?.details)
    }
    return data as T
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * Parse a text/event-stream response into typed events. Handles CRLF, multi-line data, and a stream that ends
 * without a terminal event (GenieX ends errored streams without [DONE]; our proxy always emits an `error`/`done`).
 */
export async function* readSse<T = unknown>(res: Response, signal?: AbortSignal): AsyncGenerator<T> {
  if (!res.body) throw new Error('empty response body')
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const onAbort = (): void => {
    void reader.cancel().catch(() => {})
  }
  signal?.addEventListener('abort', onAbort, { once: true })
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let idx: number
      while ((idx = buffer.search(/\r?\n\r?\n/)) !== -1) {
        const raw = buffer.slice(0, idx)
        buffer = buffer.slice(idx).replace(/^\r?\n\r?\n/, '')
        const dataLines = raw
          .split(/\r?\n/)
          .filter((l) => l.startsWith('data:'))
          .map((l) => l.slice(5).replace(/^ /, ''))
        if (!dataLines.length) continue
        const payload = dataLines.join('\n')
        if (payload === '[DONE]') return
        try {
          yield JSON.parse(payload) as T
        } catch {
          // ignore malformed frame
        }
      }
    }
  } finally {
    signal?.removeEventListener('abort', onAbort)
    reader.releaseLock()
  }
}
