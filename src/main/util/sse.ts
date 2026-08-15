/**
 * Parse a text/event-stream body into data payloads. Tolerates CRLF, multi-line `data:` fields, comments,
 * and streams that end without a terminal sentinel (GenieX ends errored streams without `[DONE]`).
 * Yields the raw payload string per event; the caller decides what `[DONE]` means.
 */
export async function* parseSse(body: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncGenerator<string> {
  const reader = body.getReader()
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
        const frame = buffer.slice(0, idx)
        buffer = buffer.slice(idx).replace(/^\r?\n\r?\n/, '')
        const data = frameData(frame)
        if (data !== null) yield data
      }
    }
    // Flush a trailing frame without terminating blank line.
    const rest = buffer.trim()
    if (rest) {
      const data = frameData(rest)
      if (data !== null) yield data
    }
  } finally {
    signal?.removeEventListener('abort', onAbort)
    try {
      reader.releaseLock()
    } catch {
      /* already released */
    }
  }
}

/**
 * GenieX omits Content-Type on some streaming paths (e.g. reasoning_format:'auto' with thinking on), so decide
 * SSE-vs-JSON by peeking at the first non-whitespace bytes instead of trusting headers. Returns the kind plus a
 * stream that replays the peeked bytes.
 */
export async function sniffBody(body: ReadableStream<Uint8Array>): Promise<{ kind: 'sse' | 'json' | 'empty'; stream: ReadableStream<Uint8Array> }> {
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let text = ''
  const decoder = new TextDecoder()
  while (text.trim().length < 6) {
    const { value, done } = await reader.read()
    if (done) break
    chunks.push(value)
    text += decoder.decode(value, { stream: true })
  }
  const head = text.trimStart()
  const kind: 'sse' | 'json' | 'empty' = !head ? 'empty' : head.startsWith('data:') || head.startsWith(':') || head.startsWith('event:') ? 'sse' : 'json'
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      for (const c of chunks) controller.enqueue(c)
    },
    async pull(controller) {
      const { value, done } = await reader.read()
      if (done) controller.close()
      else controller.enqueue(value)
    },
    cancel(reason) {
      return reader.cancel(reason)
    },
  })
  return { kind, stream }
}

export async function readAllText(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let out = ''
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    out += decoder.decode(value, { stream: true })
  }
  return out
}

function frameData(frame: string): string | null {
  const lines = frame.split(/\r?\n/)
  const data: string[] = []
  for (const line of lines) {
    if (line.startsWith(':')) continue
    if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''))
  }
  return data.length ? data.join('\n') : null
}
