import { promises as fs } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { clip, type Tool, type ToolRunContext } from './types'

const IGNORE_DIRS = new Set(['node_modules', '.git', 'dist', 'out', 'build', '.next', '.cache', 'release', '__pycache__', '.venv', 'venv', 'target', 'bin', 'obj'])
const MAX_READ = 200_000

/** Resolve a user/model-supplied path inside the workspace; refuses traversal outside it. */
export function resolveInWorkspace(root: string, p: unknown): string {
  const raw = typeof p === 'string' && p.trim() ? p.trim() : '.'
  const abs = resolve(root, raw)
  const rootAbs = resolve(root)
  if (abs !== rootAbs && !abs.startsWith(rootAbs + sep)) throw new Error(`Path is outside the workspace: ${raw}`)
  return abs
}

function rel(root: string, abs: string): string {
  const r = relative(root, abs)
  return r === '' ? '.' : r.split(sep).join('/')
}

async function snapshotForRollback(rc: ToolRunContext, absPath: string): Promise<void> {
  try {
    const data = await fs.readFile(absPath)
    const dest = join(rc.ctx.dataDir, 'checkpoints', rc.runId, rel(rc.workspaceRoot, absPath).replace(/[\\/]/g, '__'))
    await fs.mkdir(dirname(dest), { recursive: true })
    await fs.writeFile(dest, data)
  } catch {
    /* new file: nothing to snapshot */
  }
}

export const readFileTool: Tool = {
  name: 'read_file',
  family: 'fs',
  risk: 'read',
  description: 'Read a UTF-8 text file from the workspace. Returns the content with line numbers. Use offset/limit for large files.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Path relative to the workspace root' },
      offset: { type: 'integer', description: '1-based first line to return (default 1)' },
      limit: { type: 'integer', description: 'Max lines to return (default 400)' },
    },
    required: ['path'],
  },
  summarize: (a) => `Read ${String(a.path ?? '')}`,
  needsApproval: () => false,
  async run(a, rc) {
    const abs = resolveInWorkspace(rc.workspaceRoot, a.path)
    const st = await fs.stat(abs)
    if (st.isDirectory()) return { ok: false, content: `${rel(rc.workspaceRoot, abs)} is a directory — use list_dir.` }
    if (st.size > 8 * 1024 * 1024) return { ok: false, content: 'File is larger than 8 MB.' }
    const buf = await fs.readFile(abs)
    if (buf.subarray(0, 512).includes(0)) return { ok: false, content: 'Binary file (not shown).', meta: { size: st.size } }
    const lines = buf.toString('utf8').split(/\r?\n/)
    const offset = Math.max(1, Number(a.offset ?? 1))
    const limit = Math.max(1, Math.min(2000, Number(a.limit ?? 400)))
    const slice = lines.slice(offset - 1, offset - 1 + limit)
    const body = slice.map((l, i) => `${String(offset + i).padStart(5)}  ${l}`).join('\n')
    const more = offset - 1 + limit < lines.length ? `\n…(${lines.length - (offset - 1 + limit)} more lines; total ${lines.length})` : ''
    return { ok: true, content: clip(body + more, MAX_READ), meta: { path: rel(rc.workspaceRoot, abs), lines: lines.length } }
  },
}

export const listDirTool: Tool = {
  name: 'list_dir',
  family: 'fs',
  risk: 'read',
  description: 'List files and folders in a workspace directory (recursive up to depth, ignoring node_modules/.git etc).',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Directory relative to the workspace root (default ".")' },
      depth: { type: 'integer', description: 'Recursion depth (default 2, max 6)' },
    },
  },
  summarize: (a) => `List ${String(a.path ?? '.')}`,
  needsApproval: () => false,
  async run(a, rc) {
    const abs = resolveInWorkspace(rc.workspaceRoot, a.path)
    const depth = Math.max(0, Math.min(6, Number(a.depth ?? 2)))
    const out: string[] = []
    let count = 0
    const walk = async (d: string, level: number): Promise<void> => {
      if (count > 2000) return
      const entries = (await fs.readdir(d, { withFileTypes: true }).catch(() => [])).sort((x, y) => Number(y.isDirectory()) - Number(x.isDirectory()) || x.name.localeCompare(y.name))
      for (const e of entries) {
        if (IGNORE_DIRS.has(e.name)) continue
        count++
        const p = join(d, e.name)
        const indent = '  '.repeat(level)
        if (e.isDirectory()) {
          out.push(`${indent}${e.name}/`)
          if (level < depth) await walk(p, level + 1)
        } else {
          const st = await fs.stat(p).catch(() => null)
          out.push(`${indent}${e.name}${st ? `  (${st.size} B)` : ''}`)
        }
      }
    }
    await walk(abs, 0)
    return { ok: true, content: clip(`${rel(rc.workspaceRoot, abs)}/\n${out.join('\n')}` || '(empty)'), meta: { entries: count } }
  },
}

export const searchFilesTool: Tool = {
  name: 'search_files',
  family: 'fs',
  risk: 'read',
  description: 'Search file contents in the workspace with a regular expression (case-insensitive). Returns file:line: match. Optionally filter by a filename glob-like substring.',
  parameters: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Regular expression to search for' },
      path: { type: 'string', description: 'Directory to search (default ".")' },
      include: { type: 'string', description: 'Only files whose path contains this substring or extension, e.g. ".ts" or "src/"' },
      max_results: { type: 'integer', description: 'Max matches (default 100)' },
    },
    required: ['pattern'],
  },
  summarize: (a) => `Search /${String(a.pattern ?? '')}/ in ${String(a.path ?? '.')}`,
  needsApproval: () => false,
  async run(a, rc) {
    const abs = resolveInWorkspace(rc.workspaceRoot, a.path)
    let re: RegExp
    try {
      re = new RegExp(String(a.pattern ?? ''), 'i')
    } catch (e) {
      return { ok: false, content: `Invalid regex: ${e instanceof Error ? e.message : String(e)}` }
    }
    const include = typeof a.include === 'string' ? a.include : null
    const max = Math.max(1, Math.min(500, Number(a.max_results ?? 100)))
    const hits: string[] = []
    let scanned = 0
    const walk = async (d: string): Promise<void> => {
      if (hits.length >= max || scanned > 5000) return
      for (const e of await fs.readdir(d, { withFileTypes: true }).catch(() => [])) {
        if (hits.length >= max) return
        if (IGNORE_DIRS.has(e.name)) continue
        const p = join(d, e.name)
        if (e.isDirectory()) await walk(p)
        else {
          const r = rel(rc.workspaceRoot, p)
          if (include && !r.includes(include)) continue
          const st = await fs.stat(p).catch(() => null)
          if (!st || st.size > 2 * 1024 * 1024) continue
          scanned++
          const buf = await fs.readFile(p).catch(() => null)
          if (!buf || buf.subarray(0, 512).includes(0)) continue
          const lines = buf.toString('utf8').split(/\r?\n/)
          for (let i = 0; i < lines.length && hits.length < max; i++) if (re.test(lines[i])) hits.push(`${r}:${i + 1}: ${lines[i].trim().slice(0, 240)}`)
        }
      }
    }
    await walk(abs)
    return { ok: true, content: hits.length ? clip(hits.join('\n')) : 'No matches.', meta: { matches: hits.length, filesScanned: scanned } }
  },
}

export const writeFileTool: Tool = {
  name: 'write_file',
  family: 'fs',
  risk: 'write',
  description: 'Create or overwrite a text file in the workspace with the given content. Parent folders are created.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Path relative to the workspace root' },
      content: { type: 'string', description: 'Full file content' },
    },
    required: ['path', 'content'],
  },
  summarize: (a) => `Write ${String(a.path ?? '')} (${String(a.content ?? '').length} chars)`,
  needsApproval: () => true,
  async run(a, rc) {
    const abs = resolveInWorkspace(rc.workspaceRoot, a.path)
    await snapshotForRollback(rc, abs)
    await fs.mkdir(dirname(abs), { recursive: true })
    const content = String(a.content ?? '')
    await fs.writeFile(abs, content, 'utf8')
    return { ok: true, content: `Wrote ${rel(rc.workspaceRoot, abs)} (${content.length} chars, ${content.split('\n').length} lines).`, meta: { path: rel(rc.workspaceRoot, abs), bytes: Buffer.byteLength(content) } }
  },
}

export const editFileTool: Tool = {
  name: 'edit_file',
  family: 'fs',
  risk: 'write',
  description: 'Replace an exact text snippet in a workspace file. old_text must match exactly once (or set replace_all). Prefer this over write_file for small changes.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string' },
      old_text: { type: 'string', description: 'Exact text to find' },
      new_text: { type: 'string', description: 'Replacement text' },
      replace_all: { type: 'boolean' },
    },
    required: ['path', 'old_text', 'new_text'],
  },
  summarize: (a) => `Edit ${String(a.path ?? '')}`,
  needsApproval: () => true,
  async run(a, rc) {
    const abs = resolveInWorkspace(rc.workspaceRoot, a.path)
    const src = await fs.readFile(abs, 'utf8')
    const oldText = String(a.old_text ?? '')
    const newText = String(a.new_text ?? '')
    if (!oldText) return { ok: false, content: 'old_text is empty.' }
    const count = src.split(oldText).length - 1
    if (count === 0) return { ok: false, content: 'old_text was not found in the file. Read the file again and copy the exact snippet.' }
    if (count > 1 && !a.replace_all) return { ok: false, content: `old_text matches ${count} times; include more context to make it unique or set replace_all: true.` }
    await snapshotForRollback(rc, abs)
    const next = a.replace_all ? src.split(oldText).join(newText) : src.replace(oldText, () => newText)
    await fs.writeFile(abs, next, 'utf8')
    return { ok: true, content: `Edited ${rel(rc.workspaceRoot, abs)}: ${a.replace_all ? count : 1} replacement(s).`, meta: { path: rel(rc.workspaceRoot, abs), replacements: a.replace_all ? count : 1, diff: unifiedDiff(src, next, rel(rc.workspaceRoot, abs)) } }
  },
}

/** Compact line diff for the timeline (not a full LCS — enough to show what changed). */
export function unifiedDiff(a: string, b: string, name: string): string {
  const al = a.split('\n')
  const bl = b.split('\n')
  let start = 0
  while (start < al.length && start < bl.length && al[start] === bl[start]) start++
  let endA = al.length - 1
  let endB = bl.length - 1
  while (endA >= start && endB >= start && al[endA] === bl[endB]) {
    endA--
    endB--
  }
  const ctxBefore = al.slice(Math.max(0, start - 2), start).map((l) => ` ${l}`)
  const removed = al.slice(start, endA + 1).map((l) => `-${l}`)
  const added = bl.slice(start, endB + 1).map((l) => `+${l}`)
  const ctxAfter = al.slice(endA + 1, endA + 3).map((l) => ` ${l}`)
  return [`--- ${name}`, `+++ ${name}`, `@@ -${start + 1},${removed.length} +${start + 1},${added.length} @@`, ...ctxBefore, ...removed, ...added, ...ctxAfter].join('\n').slice(0, 6000)
}

export const fsTools: Tool[] = [readFileTool, listDirTool, searchFilesTool, writeFileTool, editFileTool]
