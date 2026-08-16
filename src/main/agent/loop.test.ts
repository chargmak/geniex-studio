import { describe, expect, it } from 'vitest'
import { extractInlineToolCall, parseToolArgs } from './loop'
import { htmlToText } from './tools/web'
import { resolveInWorkspace, unifiedDiff } from './tools/fs'
import { assemblePrompt, estimateTokens } from '../chat/prompt'
import type { StoredMessage } from '@shared/chat'

describe('parseToolArgs', () => {
  it('parses clean JSON', () => {
    expect(parseToolArgs('{"path":"a.txt"}')).toEqual({ args: { path: 'a.txt' }, repaired: false })
  })
  it('repairs fenced, trailing-comma and single-quoted JSON', () => {
    expect(parseToolArgs('```json\n{"path":"a.txt",}\n```').args).toEqual({ path: 'a.txt' })
    expect(parseToolArgs("{'path': 'a.txt'}").args).toEqual({ path: 'a.txt' })
    expect(parseToolArgs('{path: "a.txt"}').args).toEqual({ path: 'a.txt' })
  })
  it('reports unparseable input (e.g. a lone brace) as an error', () => {
    const r = parseToolArgs('{')
    expect(r.error).toBeTruthy()
    expect(r.args).toEqual({})
  })
  it('treats empty as no args', () => {
    expect(parseToolArgs('')).toEqual({ args: {}, repaired: false })
  })
})

describe('extractInlineToolCall', () => {
  const known = new Set(['read_file', 'run_command'])
  it('reads <tool_call> tags', () => {
    const c = extractInlineToolCall('Let me look.\n<tool_call>{"name":"read_file","arguments":{"path":"x"}}</tool_call>', known)
    expect(c?.function.name).toBe('read_file')
    expect(JSON.parse(c!.function.arguments)).toEqual({ path: 'x' })
  })
  it('reads fenced json calls and ignores unknown tools', () => {
    expect(extractInlineToolCall('```json\n{"name":"run_command","arguments":{"command":"dir"}}\n```', known)?.function.name).toBe('run_command')
    expect(extractInlineToolCall('```json\n{"name":"nope","arguments":{}}\n```', known)).toBeNull()
  })
})

describe('htmlToText', () => {
  it('strips scripts/nav and keeps headings, lists and links', () => {
    const { title, text } = htmlToText('<html><head><title>T &amp; U</title><script>x()</script></head><body><nav>menu</nav><main><h1>Hello</h1><p>World <a href="https://x.y/z">link</a></p><ul><li>one</li><li>two</li></ul></main></body></html>')
    expect(title).toBe('T & U')
    expect(text).toContain('# Hello')
    expect(text).toContain('link (https://x.y/z)')
    expect(text).toContain('- one')
    expect(text).not.toContain('menu')
    expect(text).not.toContain('x()')
  })
})

describe('resolveInWorkspace', () => {
  const root = process.platform === 'win32' ? 'C:\\ws' : '/ws'
  it('allows paths inside the workspace', () => {
    expect(resolveInWorkspace(root, 'a/b.txt').startsWith(root)).toBe(true)
    expect(resolveInWorkspace(root, '.')).toBe(root)
  })
  it('refuses traversal outside the workspace', () => {
    expect(() => resolveInWorkspace(root, '../secret')).toThrow(/outside/)
    expect(() => resolveInWorkspace(root, process.platform === 'win32' ? 'C:\\Windows\\x' : '/etc/passwd')).toThrow(/outside/)
  })
})

describe('unifiedDiff', () => {
  it('shows removed/added lines around the change', () => {
    const d = unifiedDiff('a\nb\nc\nd', 'a\nB\nc\nd', 'f.txt')
    expect(d).toContain('-b')
    expect(d).toContain('+B')
    expect(d).toContain('--- f.txt')
  })
})

function msg(role: StoredMessage['role'], content: string, extra: Partial<StoredMessage> = {}): StoredMessage {
  return { id: Math.random().toString(36).slice(2), conversationId: 'c', seq: 0, role, content, reasoning: null, toolCalls: null, toolCallId: null, name: null, model: null, status: 'complete', error: null, metrics: null, attachments: [], createdAt: 0, ...extra }
}

describe('assemblePrompt', () => {
  it('prepends the system prompt and keeps history in order', () => {
    const r = assemblePrompt([msg('user', 'hi'), msg('assistant', 'hello'), msg('user', 'more')], { systemPrompt: 'SYS', contextTokens: 4096, maxTokens: 512, vision: false })
    expect(r.messages[0]).toEqual({ role: 'system', content: 'SYS' })
    expect(r.messages.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user'])
    expect(r.droppedHistory).toBe(0)
  })
  it('drops oldest history to fit the budget but never the last message', () => {
    const big = 'x'.repeat(4000) // ~1100 tokens each
    const history = [msg('user', big), msg('assistant', big), msg('user', big), msg('assistant', big), msg('user', 'final')]
    const r = assemblePrompt(history, { systemPrompt: null, contextTokens: 2048, maxTokens: 256, vision: false })
    expect(r.droppedHistory).toBeGreaterThan(0)
    expect(r.messages.at(-1)).toMatchObject({ role: 'user', content: 'final' })
    expect(r.estimatedTokens).toBeLessThanOrEqual(2048 - 256)
  })
  it('only sends media from the last message and only for vision models', () => {
    const att = { id: 'a1', messageId: null, conversationId: 'c', kind: 'image' as const, name: 'p.png', mime: 'image/png', size: 1, path: 'C:/p.png', width: 1, height: 1, createdAt: 0 }
    const history = [msg('user', 'first', { attachments: [att] }), msg('assistant', 'ok'), msg('user', 'look', { attachments: [att] })]
    const vis = assemblePrompt(history, { systemPrompt: null, contextTokens: 4096, maxTokens: 256, vision: true })
    const last = vis.messages.at(-1)!
    expect(Array.isArray(last.content)).toBe(true)
    expect((last.content as unknown[]).some((p) => (p as { type: string }).type === 'image_url')).toBe(true)
    expect(typeof vis.messages[0].content).toBe('string') // earlier image dropped
    expect(vis.imagesStripped).toBe(1)
    const txt = assemblePrompt(history, { systemPrompt: null, contextTokens: 4096, maxTokens: 256, vision: false })
    expect(txt.messages.every((m) => typeof m.content === 'string')).toBe(true)
    expect(txt.imagesStripped).toBe(2)
  })
  it('drops droppable sections before failing', () => {
    const r = assemblePrompt([msg('user', 'q')], { systemPrompt: 'S', contextTokens: 600, maxTokens: 64, vision: false, extraSections: [{ label: 'skills', text: 'y'.repeat(3000), droppable: true }, { label: 'agent', text: 'must stay', droppable: false }] })
    expect(r.droppedSections).toEqual(['skills'])
    expect(String(r.messages[0].content)).toContain('must stay')
  })
  it('estimates tokens roughly at chars/3.6', () => {
    expect(estimateTokens('a'.repeat(360))).toBe(100)
  })
})
