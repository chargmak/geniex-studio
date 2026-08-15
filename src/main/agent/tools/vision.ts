import { promises as fs } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import type { Tool } from './types'
import { resolveInWorkspace } from './fs'

/**
 * analyze_image — routes a question about an image to the configured Vision model. Because GenieX keeps a
 * single model resident, this swaps models (seconds) and swaps back on the next text turn; the description warns
 * the agent to batch questions.
 */
export const analyzeImageTool: Tool = {
  name: 'analyze_image',
  family: 'vision',
  risk: 'read',
  description:
    'Look at an image with the local Vision model and answer a question about it (describe, read text/OCR, count objects…). Accepts a workspace-relative path, an absolute path, or an attachment id. Model swaps are slow — ask everything you need in one call.',
  parameters: {
    type: 'object',
    properties: {
      image: { type: 'string', description: 'Workspace path, absolute path, or attachment id of the image' },
      question: { type: 'string', description: 'What to find out about the image' },
    },
    required: ['image', 'question'],
  },
  summarize: (a) => `Analyze image ${String(a.image ?? '')}`,
  needsApproval: () => false,
  async run(a, rc) {
    const { ctx } = rc
    const s = ctx.settings.get()
    const installed = await ctx.models.list().catch(() => [])
    const vlm = installed.find((m) => m.requestIds.includes(s.defaults.visionModel ?? '')) ?? installed.find((m) => m.type === 'vlm')
    if (!vlm) return { ok: false, content: 'No Vision model is installed. Pull one (e.g. a Qwen3-VL GGUF) from the Models page.' }
    const modelId = s.defaults.visionModel && vlm.requestIds.includes(s.defaults.visionModel) ? s.defaults.visionModel : vlm.requestIds[0]

    const ref = String(a.image ?? '').trim()
    let path: string | null = null
    const att = ctx.repos.attachments.get(ref)
    if (att) path = att.path
    else if (isAbsolute(ref)) path = resolve(ref)
    else path = resolveInWorkspace(rc.workspaceRoot, ref)
    await fs.access(path)

    let text = ''
    let err: string | null = null
    for await (const ev of ctx.client.chatStream(
      {
        model: modelId,
        messages: [{ role: 'user', content: [{ type: 'text', text: String(a.question ?? 'Describe this image.') }, { type: 'image_url', image_url: { url: path } }] }],
        sampler: { max_tokens: 768, temperature: 0.2 },
        options: { enable_think: false, ...(vlm.runtime !== 'qairt' ? { compute: s.defaults.computeGguf } : {}) },
      },
      rc.signal,
    )) {
      if (ev.type === 'delta' && ev.content) text += ev.content
      if (ev.type === 'error') err = ev.message
    }
    if (err) return { ok: false, content: `Vision model error: ${err}` }
    return { ok: true, content: text.trim() || '(no answer)', meta: { model: modelId, image: path } }
  },
}
