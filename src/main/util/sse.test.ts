import { describe, expect, it } from 'vitest'
import { parseSse, readAllText, sniffBody } from './sse'

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c))
      controller.close()
    },
  })
}

async function collect(s: ReadableStream<Uint8Array>): Promise<string[]> {
  const out: string[] = []
  for await (const p of parseSse(s)) out.push(p)
  return out
}

describe('parseSse', () => {
  it('parses LF-delimited data frames and [DONE]', async () => {
    const out = await collect(streamOf(['data:{"a":1}\n\ndata: {"b":2}\n\ndata: [DONE]\n\n']))
    expect(out).toEqual(['{"a":1}', '{"b":2}', '[DONE]'])
  })
  it('handles CRLF and frames split across chunks', async () => {
    const out = await collect(streamOf(['data:{"a":', '1}\r\n\r\ndata:{"b":2}\r\n', '\r\n']))
    expect(out).toEqual(['{"a":1}', '{"b":2}'])
  })
  it('joins multi-line data fields and ignores comments/other fields', async () => {
    const out = await collect(streamOf([': ping\nevent: x\ndata: line1\ndata: line2\n\n']))
    expect(out).toEqual(['line1\nline2'])
  })
  it('flushes a trailing frame that ends without a blank line (GenieX error frames end the stream abruptly)', async () => {
    const out = await collect(streamOf(['data:{"error":"boom","code":-1}']))
    expect(out).toEqual(['{"error":"boom","code":-1}'])
  })
})

describe('sniffBody', () => {
  it('detects SSE by leading data: even without Content-Type', async () => {
    const { kind, stream } = await sniffBody(streamOf(['data:{"x":1}\n\n']))
    expect(kind).toBe('sse')
    expect(await collect(stream)).toEqual(['{"x":1}'])
  })
  it('detects JSON bodies and replays the peeked bytes', async () => {
    const { kind, stream } = await sniffBody(streamOf(['{"cho', 'ices":[]}']))
    expect(kind).toBe('json')
    expect(JSON.parse(await readAllText(stream))).toEqual({ choices: [] })
  })
  it('reports empty bodies', async () => {
    const { kind } = await sniffBody(streamOf(['   ']))
    expect(kind).toBe('empty')
  })
})
