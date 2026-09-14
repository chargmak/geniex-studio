// Phase 0 HTTP checks against a running `geniex serve` (v0.6.1). Usage: node phase0.mjs [test...]
// Tests: t2 (streaming tool calls), t3 (KV reuse / continuation), t5 (npu vs hybrid), t8 (context errors), models
import { writeFileSync } from 'node:fs'

const BASE = process.env.GENIEX_BASE ?? 'http://127.0.0.1:18181'
const MODEL = process.env.MODEL ?? 'unsloth/Qwen3-4B-GGUF:Q4_0'
const results = {}
const want = new Set(process.argv.slice(2))
const run = (name) => want.size === 0 || want.has(name)

async function chat(body, { stream = true, tag = '' } = {}) {
  const t0 = performance.now()
  const res = await fetch(`${BASE}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream, application/json' },
    body: JSON.stringify({ stream, ...(stream ? { stream_options: { include_usage: true } } : {}), ...body }),
  })
  const r = { tag, status: res.status, ttftMs: null, firstChunkMs: null, totalMs: null, content: '', reasoning: '', toolCalls: [], chunks: 0, finish: null, usage: null, error: null, chunkLog: [] }
  if (!res.ok) {
    r.error = await res.text()
    r.totalMs = Math.round(performance.now() - t0)
    return r
  }
  const text = await readWithTiming(res, t0, (chunkMs) => {
    if (r.firstChunkMs === null) r.firstChunkMs = chunkMs
  })
  r.totalMs = Math.round(performance.now() - t0)
  const acc = new Map()
  if (stream) {
    for (const line of text.split(/\r?\n/)) {
      if (!line.startsWith('data:')) continue
      const payload = line.slice(5).trim()
      if (payload === '[DONE]') break
      let c
      try { c = JSON.parse(payload) } catch { continue }
      if (c.error !== undefined) { r.error = JSON.stringify(c); break }
      r.chunks++
      const d = c.choices?.[0]?.delta ?? {}
      if (d.content) r.content += d.content
      if (d.reasoning_content) r.reasoning += d.reasoning_content
      if (d.tool_calls) for (const tc of d.tool_calls) {
        const cur = acc.get(tc.index ?? 0) ?? { id: tc.id, name: '', args: '' }
        if (tc.function?.name) cur.name += tc.function.name
        if (tc.function?.arguments) cur.args += tc.function.arguments
        acc.set(tc.index ?? 0, cur)
        r.chunkLog.push({ chunk: r.chunks, toolIndex: tc.index, name: tc.function?.name })
      }
      if (c.choices?.[0]?.finish_reason) r.finish = c.choices[0].finish_reason
      if (c.usage) r.usage = c.usage
    }
  } else {
    const j = JSON.parse(text)
    const m = j.choices?.[0]?.message ?? {}
    r.content = m.content ?? ''
    r.reasoning = m.reasoning_content ?? ''
    for (const [i, tc] of (m.tool_calls ?? []).entries()) acc.set(i, { id: tc.id, name: tc.function?.name, args: tc.function?.arguments })
    r.finish = j.choices?.[0]?.finish_reason ?? null
    r.usage = j.usage ?? null
  }
  r.toolCalls = [...acc.values()]
  r.ttftMs = r.firstChunkMs
  return r
}

async function readWithTiming(res, t0, onChunk) {
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let out = ''
  let first = true
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    const s = dec.decode(value, { stream: true })
    // Ignore keep-alive/empty frames for TTFT.
    if (first && /"content":"[^"]|"reasoning_content":"[^"]|tool_calls/.test(s)) { onChunk(Math.round(performance.now() - t0)); first = false }
    out += s
  }
  return out
}

const brief = (r) => ({ status: r.status, ttftMs: r.ttftMs, totalMs: r.totalMs, chunks: r.chunks, finish: r.finish, usage: r.usage, toolCalls: r.toolCalls, content: r.content.slice(0, 300), reasoningChars: r.reasoning.length, error: r.error?.slice?.(0, 400) ?? r.error })
const log = (...a) => console.log(...a)

// ------------------------------------------------------------------ models
if (run('models')) {
  const list = await (await fetch(`${BASE}/v1/models`)).json()
  const ids = list.data.map((m) => m.id)
  const one = await fetch(`${BASE}/v1/models/${encodeURIComponent(ids[0])}`)
  const bare = await fetch(`${BASE}/v1/models/${encodeURIComponent(ids[0].split(':')[0])}`)
  results.models = { ids, detail: { status: one.status, body: await one.text() }, bareName: { status: bare.status, body: (await bare.text()).slice(0, 300) } }
  log('models:', JSON.stringify(results.models, null, 1))
}

const tools = [
  { type: 'function', function: { name: 'get_weather', description: 'Get current weather for a city', parameters: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] } } },
  { type: 'function', function: { name: 'get_time', description: 'Get the current local time in a city', parameters: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] } } },
]

// ------------------------------------------------------------------ T2 streaming tool calls
if (run('t2')) {
  const base = { model: MODEL, compute: 'npu', enable_think: false, reasoning_format: 'auto', max_tokens: 512, temperature: 0.2 }
  // warm-up / load
  const warm = await chat({ ...base, messages: [{ role: 'user', content: 'Reply with the single word OK.' }], max_tokens: 8 })
  log('t2 warm:', JSON.stringify(brief(warm)))
  const a = await chat({ ...base, tools, messages: [{ role: 'user', content: 'What is the weather in Athens right now, and what time is it in Tokyo? Use the tools for both.' }] })
  log('t2 two-tool prompt:', JSON.stringify(brief(a)), 'chunkLog:', JSON.stringify(a.chunkLog))
  const b = await chat({ ...base, tools, messages: [{ role: 'user', content: 'First say "Checking now." then look up the weather in Berlin using the tool.' }] })
  log('t2 prose+tool:', JSON.stringify(brief(b)))
  // Tool result round-trip: does the model see the result?
  const tc = a.toolCalls[0] ?? b.toolCalls[0]
  let c = null
  if (tc) {
    c = await chat({
      ...base, tools,
      messages: [
        { role: 'user', content: 'What is the weather in Athens right now? Use the tool.' },
        { role: 'assistant', content: '', tool_calls: [{ id: tc.id ?? 'call_1', type: 'function', function: { name: 'get_weather', arguments: '{"city":"Athens"}' } }] },
        { role: 'tool', tool_call_id: tc.id ?? 'call_1', name: 'get_weather', content: '{"city":"Athens","temp_c":31,"condition":"sunny","humidity":22}' },
      ],
    })
    log('t2 tool-result round-trip:', JSON.stringify(brief(c)))
  }
  results.t2 = { warm: brief(warm), twoTools: { ...brief(a), chunkLog: a.chunkLog }, proseAndTool: brief(b), roundTrip: c ? brief(c) : null }
}

// ------------------------------------------------------------------ T3 KV reuse / continuation
if (run('t3')) {
  const base = { model: MODEL, compute: 'npu', enable_think: false, reasoning_format: 'auto', max_tokens: 96, temperature: 0 }
  const sys = { role: 'system', content: 'You are a concise assistant. ' + 'Background reading: ' + 'The city of Athens is the capital of Greece. '.repeat(120) }
  const msgs = [sys, { role: 'user', content: 'Give three sentences on the history of Athens.' }]
  const turns = []
  const step = async (label) => {
    const r = await chat({ ...base, messages: msgs })
    turns.push({ label, ttftMs: r.ttftMs, totalMs: r.totalMs, prompt_tokens: r.usage?.prompt_tokens, completion_tokens: r.usage?.completion_tokens })
    log('t3', label, JSON.stringify(turns.at(-1)))
    msgs.push({ role: 'assistant', content: r.content })
    return r
  }
  await step('turn1 (fresh)')
  await step('turn1 again (identical history, expect reset+full prefill)')
  msgs.push({ role: 'user', content: 'And Sparta?' })
  await step('turn2 (continuation)')
  msgs.push({ role: 'user', content: 'Which of the two is older?' })
  await step('turn3 (continuation)')
  // Drop the oldest exchange (like Studio's trimming) -> not a continuation any more.
  msgs.splice(1, 2)
  msgs.push({ role: 'user', content: 'Name one famous person from each.' })
  await step('turn4 (oldest exchange dropped -> expect reset)')
  msgs.push({ role: 'user', content: 'Thanks. One more fact about Athens.' })
  await step('turn5 (continuation of trimmed history)')
  results.t3 = turns
}

// ------------------------------------------------------------------ T5 npu vs hybrid
if (run('t5')) {
  const out = {}
  for (const compute of ['npu', 'hybrid']) {
    const base = { model: MODEL, compute, enable_think: false, reasoning_format: 'auto', max_tokens: 160, temperature: 0.7 }
    try {
      const warm = await chat({ ...base, messages: [{ role: 'user', content: 'Reply OK.' }], max_tokens: 4 })
      const r = await chat({ ...base, messages: [{ role: 'user', content: 'Explain in about 150 words how a transformer generates text.' }] })
      const tps = r.usage?.completion_tokens && r.totalMs && r.ttftMs != null ? (r.usage.completion_tokens - 1) / ((r.totalMs - r.ttftMs) / 1000) : null
      out[compute] = { loadMs: warm.totalMs, ...brief(r), decodeTps: tps ? Math.round(tps * 10) / 10 : null }
    } catch (e) {
      out[compute] = { error: String(e) }
    }
    log('t5', compute, JSON.stringify(out[compute]))
    const alive = await fetch(`${BASE}/v1/`).then((r) => r.ok).catch(() => false)
    out[compute].serverAliveAfter = alive
    if (!alive) break
  }
  results.t5 = out
}

// ------------------------------------------------------------------ T9 QAIRT through the server
if (run('t9')) {
  const base = { model: 'qualcomm/Qwen3-0.6B:W4A16', reasoning_format: 'auto', max_tokens: 200, temperature: 0.2 }
  const warm = await chat({ ...base, enable_think: false, messages: [{ role: 'user', content: 'Reply OK.' }], max_tokens: 4 })
  const noThink = await chat({ ...base, enable_think: false, messages: [{ role: 'user', content: 'Say hello in five words.' }] })
  const think = await chat({ ...base, enable_think: true, messages: [{ role: 'user', content: 'Say hello in five words.' }] })
  const tool = await chat({ ...base, enable_think: false, tools, messages: [{ role: 'user', content: 'What is the weather in Athens? Use the tool.' }] })
  const tps = (r) => (r.usage?.completion_tokens && r.ttftMs != null ? Math.round(((r.usage.completion_tokens - 1) / ((r.totalMs - r.ttftMs) / 1000)) * 10) / 10 : null)
  results.t9 = { loadMs: warm.totalMs, noThink: { ...brief(noThink), decodeTps: tps(noThink) }, think: { ...brief(think), decodeTps: tps(think) }, tool: brief(tool) }
  log('t9 qairt:', JSON.stringify(results.t9, null, 1))
}

// ------------------------------------------------------------------ T4 multi-image history (GGUF VLM)
const VLM = process.env.VLM ?? 'google/gemma-4-E2B-it-qat-q4_0-gguf:Q4_0'
const here = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const img = (name) => ({ type: 'image_url', image_url: { url: `${here}${name}`.replace(/\//g, '\\') } })
if (run('t4')) {
  const base = { model: VLM, compute: 'npu', enable_think: false, max_tokens: 60, temperature: 0 }
  const warm = await chat({ ...base, messages: [{ role: 'user', content: 'Reply OK.' }], max_tokens: 4 })
  log('t4 load:', JSON.stringify(brief(warm)))
  const msgs = [{ role: 'user', content: [{ type: 'text', text: 'What colour is the background of this image, and what digit is on it? Answer briefly.' }, img('imgA.png')] }]
  const a = await chat({ ...base, messages: msgs })
  log('t4 image A:', JSON.stringify(brief(a)))
  msgs.push({ role: 'assistant', content: a.content })
  msgs.push({ role: 'user', content: [{ type: 'text', text: 'And this one?' }, img('imgB.png')] })
  const b = await chat({ ...base, messages: msgs })
  log('t4 image B:', JSON.stringify(brief(b)))
  msgs.push({ role: 'assistant', content: b.content })
  msgs.push({ role: 'user', content: 'Without repeating yourself: what was the digit on the FIRST image I sent, and what was its background colour?' })
  const c = await chat({ ...base, messages: msgs })
  log('t4 recall first image (media kept in history):', JSON.stringify(brief(c)))
  // Control: Studio's current behaviour strips media from earlier messages.
  const stripped = msgs.map((m, i) => (i === msgs.length - 1 ? m : { ...m, content: Array.isArray(m.content) ? m.content.filter((p) => p.type === 'text').map((p) => p.text).join('\n') : m.content }))
  const d = await chat({ ...base, messages: stripped })
  log('t4 recall first image (media stripped, control):', JSON.stringify(brief(d)))
  results.t4 = { loadMs: warm.totalMs, imageA: brief(a), imageB: brief(b), recallWithHistoryMedia: brief(c), recallStripped: brief(d) }
}

// ------------------------------------------------------------------ T6 audio input (GGUF VLM with conformer encoder)
if (run('t6')) {
  const base = { model: VLM, compute: 'npu', enable_think: false, max_tokens: 80, temperature: 0 }
  const wav = `${here}speech.wav`.replace(/\//g, '\\')
  const a = await chat({ ...base, messages: [{ role: 'user', content: [{ type: 'text', text: 'Transcribe this audio exactly.' }, { type: 'input_audio', input_audio: { data: wav } }] }] })
  log('t6 transcribe (path):', JSON.stringify(brief(a)))
  const { readFileSync } = await import('node:fs')
  const b64 = 'data:audio/wav;base64,' + readFileSync(wav).toString('base64')
  const b = await chat({ ...base, messages: [{ role: 'user', content: [{ type: 'text', text: 'What is being said in this audio? Then say whether the speaker sounds synthetic.' }, { type: 'input_audio', input_audio: { data: b64 } }] }] })
  log('t6 transcribe (data URL):', JSON.stringify(brief(b)))
  results.t6 = { path: brief(a), dataUrl: brief(b) }
}



// ------------------------------------------------------------------ T4b strict image recall (digit never mentioned in text)
if (run('t4b')) {
  const base = { model: VLM, compute: 'npu', enable_think: false, max_tokens: 40, temperature: 0 }
  const msgs = [{ role: 'user', content: [{ type: 'text', text: 'What colour is the background? Answer with one word only.' }, img('imgA.png')] }]
  const a = await chat({ ...base, messages: msgs }); msgs.push({ role: 'assistant', content: a.content })
  msgs.push({ role: 'user', content: [{ type: 'text', text: 'And this one? One word only.' }, img('imgB.png')] })
  const b = await chat({ ...base, messages: msgs }); msgs.push({ role: 'assistant', content: b.content })
  msgs.push({ role: 'user', content: 'What digit was printed on the FIRST image, and what digit on the second? Answer like "first: X, second: Y".' })
  const c = await chat({ ...base, messages: msgs })
  const stripped = msgs.map((m, i) => (i === msgs.length - 1 ? m : { ...m, content: Array.isArray(m.content) ? m.content.filter((p) => p.type === 'text').map((p) => p.text).join('\n') : m.content }))
  const d = await chat({ ...base, messages: stripped })
  results.t4b = { a: brief(a), b: brief(b), recallWithMedia: brief(c), recallStripped: brief(d) }
  log('t4b:', JSON.stringify(results.t4b, null, 1))
}

// ------------------------------------------------------------------ T6b audio, alternative prompts
if (run('t6b')) {
  const base = { model: VLM, compute: 'npu', enable_think: false, max_tokens: 60, temperature: 0 }
  const wav = `${here}speech.wav`.replace(/\//g, '\\')
  const out = {}
  for (const [k, text] of Object.entries({ transcribe: 'Transcribe:', wordForWord: 'Write down exactly the words spoken in this recording, word for word.', question: 'According to the recording, what did the elephant eat, and on which day?' })) {
    const r = await chat({ ...base, messages: [{ role: 'user', content: [{ type: 'text', text }, { type: 'input_audio', input_audio: { data: wav } }] }] })
    out[k] = brief(r)
    log('t6b', k, JSON.stringify(out[k]))
  }
  results.t6b = out
}


const winPath = (name) => (here + name).split('/').join(String.fromCharCode(92))
// ------------------------------------------------------------------ T4c image-encode cost per compute unit (GGUF VLM)
if (run('t4c')) {
  const out = {}
  for (const compute of (process.env.T4C_COMPUTE ?? 'cpu,hybrid,npu').split(',')) {
    const base = { model: VLM, compute, enable_think: false, max_tokens: 12, temperature: 0 }
    const warm = await chat({ ...base, messages: [{ role: 'user', content: 'Reply OK.' }], max_tokens: 4 })
    const r1 = await chat({ ...base, messages: [{ role: 'user', content: [{ type: 'text', text: 'Background colour? One word.' }, img('imgA.png')] }] })
    const r2 = await chat({ ...base, messages: [{ role: 'user', content: [{ type: 'text', text: 'Background colour of this one? One word.' }, img('imgB.png')] }] })
    out[compute] = { loadMs: warm.totalMs, image1: brief(r1), image2: brief(r2), alive: await fetch(BASE + '/v1/').then((r) => r.ok).catch(() => false) }
    log('t4c', compute, JSON.stringify(out[compute]))
    if (!out[compute].alive) break
  }
  results.t4c = out
}
// ------------------------------------------------------------------ T6c audio with a slower, clearer synthetic voice
if (run('t6c')) {
  const base = { model: VLM, compute: 'npu', enable_think: false, max_tokens: 60, temperature: 0 }
  const out = {}
  for (const [k, text] of Object.entries({ wordForWord: 'Write down exactly the words spoken in this recording, word for word.', question: 'What number is mentioned in the recording, and what colour?' })) {
    const r = await chat({ ...base, messages: [{ role: 'user', content: [{ type: 'text', text }, { type: 'input_audio', input_audio: { data: winPath('speech2.wav') } }] }] })
    out[k] = brief(r); log('t6c', k, JSON.stringify(out[k]))
  }
  results.t6c = out
}
// ------------------------------------------------------------------ T8q QAIRT context overflow via server (fixed ctx, no sliding window param)
if (run('t8qairt')) {
  const base = { model: 'qualcomm/Qwen3-0.6B:W4A16', enable_think: false, max_tokens: 32, temperature: 0 }
  const filler = 'The quick brown fox jumps over the lazy dog. '.repeat(700)
  const r = await chat({ ...base, messages: [{ role: 'user', content: filler + ' Summarise in one word.' }] }).catch((e) => ({ error: String(e) }))
  results.t8qairt = { tooLong: r.status ? brief(r) : r, alive: await fetch(BASE + '/v1/').then((x) => x.ok).catch(() => false) }
  log('t8qairt:', JSON.stringify(results.t8qairt))
}

// ------------------------------------------------------------------ T10 runtime switching order (GGUF <-> QAIRT in one server)
if (run('t10')) {
  const ping = (model, extra = {}) => chat({ model, enable_think: false, max_tokens: 4, temperature: 0, ...extra, messages: [{ role: 'user', content: 'Reply OK.' }] }).then((r) => ({ status: r.status, ms: r.totalMs, content: r.content.slice(0, 40), error: r.error?.slice?.(0, 200) ?? r.error }))
  const seq = []
  const step = async (label, model, extra) => { const r = await ping(model, extra); seq.push({ label, model, ...r }); log('t10', label, JSON.stringify(seq.at(-1))) }
  await step('1 gguf 0.6B npu', 'unsloth/Qwen3-0.6B-GGUF:Q4_0', { compute: 'npu' })
  await step('2 qairt 0.6B', 'qualcomm/Qwen3-0.6B:W4A16')
  await step('3 gguf 0.6B npu again', 'unsloth/Qwen3-0.6B-GGUF:Q4_0', { compute: 'npu' })
  await step('4 gguf 0.6B cpu', 'unsloth/Qwen3-0.6B-GGUF:Q4_0', { compute: 'cpu' })
  await step('5 qairt 0.6B again', 'qualcomm/Qwen3-0.6B:W4A16')
  results.t10 = seq
}

// ------------------------------------------------------------------ T8 context errors (S5) — may crash the server on npu, run last
if (run('t8cpu') || run('t8npu')) {
  const compute = run('t8cpu') ? 'cpu' : 'npu'
  const base = { model: MODEL, compute, enable_think: false, nctx: 4096, temperature: 0 }
  const out = { compute }
  const filler = 'The quick brown fox jumps over the lazy dog. '.repeat(700) // ~7k tokens
  const tooLong = process.env.T8_ONLY_FILL ? { status: 200, skipped: true } : await chat({ ...base, max_tokens: 32, messages: [{ role: 'user', content: filler + '\nSummarise the above in one word.' }] }).catch((e) => ({ error: String(e) }))
  out.tooLong = tooLong.skipped ? 'skipped' : tooLong.status ? brief(tooLong) : tooLong
  log('t8', compute, 'prompt too long:', JSON.stringify(out.tooLong))
  out.aliveAfterTooLong = await fetch(`${BASE}/v1/`).then((r) => r.ok).catch(() => false)
  if (out.aliveAfterTooLong) {
    const near = 'The quick brown fox jumps over the lazy dog. '.repeat(300) // ~3k tokens
    const fill = await chat({ ...base, max_tokens: 2048, messages: [{ role: 'user', content: near + '\nNow write a very long story, at least 1500 words, about a fox. Do not stop early.' }] }).catch((e) => ({ error: String(e) }))
    out.fillMidGen = fill.status ? brief(fill) : fill
    log('t8', compute, 'fill mid-generation:', JSON.stringify(out.fillMidGen))
    out.aliveAfterFill = await fetch(`${BASE}/v1/`).then((r) => r.ok).catch(() => false)
  }
  results['t8_' + compute] = out
}

const { existsSync, readFileSync: rf } = await import('node:fs')
const prev = existsSync('phase0-results.json') ? JSON.parse(rf('phase0-results.json', 'utf8')) : {}
writeFileSync('phase0-results.json', JSON.stringify({ ...prev, ...results }, null, 2))
log('written phase0-results.json')
