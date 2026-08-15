import type { ToolInfo } from '@shared/agent'
import type { AppContext } from '../server/context'
import { fsTools } from './tools/fs'
import { shellTools } from './tools/shell'
import { webTools } from './tools/web'
import { analyzeImageTool } from './tools/vision'
import type { Tool } from './tools/types'

/** Assemble the tool set for a run from enabled families (+ live MCP tools). */
export async function buildToolset(ctx: AppContext, opts: { families?: string[]; hasVisionModel?: boolean } = {}): Promise<Tool[]> {
  const families = new Set(opts.families ?? ctx.settings.get().agent.enabledFamilies)
  const tools: Tool[] = []
  if (families.has('fs')) tools.push(...fsTools)
  if (families.has('shell')) tools.push(...shellTools)
  if (families.has('web')) tools.push(...webTools)
  if (families.has('vision')) {
    const hasVlm = opts.hasVisionModel ?? (await ctx.models.list().catch(() => [])).some((m) => m.type === 'vlm')
    if (hasVlm) tools.push(analyzeImageTool)
  }
  if (families.has('mcp')) tools.push(...ctx.mcp.tools())
  return tools
}

export function toolInfos(tools: Tool[]): ToolInfo[] {
  return tools.map(({ name, description, risk, family, source }) => ({ name, description, risk, family, source }))
}
