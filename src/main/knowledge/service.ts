import { EventEmitter } from 'node:events'
import { promises as fs } from 'node:fs'
import { basename, extname, join, relative } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Database } from '../db'
import type { SidecarSupervisor } from '../sidecar/supervisor'
import type { KnowledgeHit, KnowledgeSource } from '@shared/sidecar'

/** Text-like files we index. PDFs/Office docs are intentionally out (no parser dependency); the UI says so. */
const TEXT_EXT = new Set([
  '.md', '.markdown', '.mdx', '.txt', '.text', '.rst', '.adoc', '.org',
  '.json', '.jsonl', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf', '.env.example',
  '.csv', '.tsv', '.log',
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.rb', '.go', '.rs', '.java', '.kt', '.cs', '.cpp', '.cc', '.c', '.h', '.hpp', '.swift', '.php', '.sh', '.ps1', '.psm1', '.bat', '.sql', '.r', '.lua', '.dart', '.scala',
  '.html', '.htm', '.css', '.scss', '.less', '.xml', '.svg', '.vue', '.svelte',
])
const SKIP_DIRS = new Set(['node_modules', '.git', '.hg', '.svn', 'dist', 'build', 'out', '.next', '.nuxt', '.venv', 'venv', '__pycache__', '.cache', 'coverage', 'target', 'bin', 'obj', '.idea', '.vscode', 'release'])
const MAX_FILE_BYTES = 2 * 1024 * 1024
const MAX_FILES = 2000
const CHUNK_CHARS = 1400
const CHUNK_OVERLAP = 200
const EMBED_BATCH = 24

export interface KnowledgeProgress {
  sourceId: string
  phase: 'scanning' | 'embedding' | 'ready' | 'error'
  files: number
  chunks: number
  done: number
  message?: string
}

interface ChunkRow {
  id: number
  source_id: string
  file: string
  ord: number
  text: string
  embedding: Buffer | null
  dims: number | null
}

interface SourceRow {
  id: string
  name: string
  kind: 'folder' | 'file'
  path: string
  files: number
  chunks: number
  embed_model: string | null
  status: KnowledgeSource['status']
  error: string | null
  created_at: number
  updated_at: number
}

function rowToSource(r: SourceRow): KnowledgeSource {
  return { id: r.id, name: r.name, kind: r.kind, path: r.path, files: r.files, chunks: r.chunks, embedModel: r.embed_model, status: r.status, error: r.error, createdAt: r.created_at, updatedAt: r.updated_at }
}

/** Split text into overlapping chunks, preferring paragraph then line boundaries. */
export function chunkText(text: string, size = CHUNK_CHARS, overlap = CHUNK_OVERLAP): string[] {
  const clean = text.replace(/\r\n?/g, '\n').replace(/\u0000/g, '')
  if (clean.trim().length === 0) return []
  if (clean.length <= size) return [clean.trim()]
  const chunks: string[] = []
  let start = 0
  while (start < clean.length) {
    let end = Math.min(clean.length, start + size)
    if (end < clean.length) {
      // look for a natural boundary in the last 30% of the window
      const window = clean.slice(start + Math.floor(size * 0.7), end)
      const para = window.lastIndexOf('\n\n')
      const line = window.lastIndexOf('\n')
      const sentence = Math.max(window.lastIndexOf('. '), window.lastIndexOf('.\n'))
      const cut = para >= 0 ? para + 2 : line >= 0 ? line + 1 : sentence >= 0 ? sentence + 2 : -1
      if (cut > 0) end = start + Math.floor(size * 0.7) + cut
    }
    const piece = clean.slice(start, end).trim()
    if (piece) chunks.push(piece)
    if (end >= clean.length) break
    start = Math.max(end - overlap, start + 1)
  }
  return chunks
}

/** Local knowledge base: text sources → chunks → NPU embeddings (nomic) → cosine top-k. */
export class KnowledgeService extends EventEmitter {
  private cache = new Map<string, { ids: Int32Array; files: string[]; ords: Int32Array; texts: string[]; matrix: Float32Array; dims: number }>()
  private indexing = new Set<string>()

  constructor(private readonly db: Database, private readonly sidecar: SidecarSupervisor) {
    super()
  }

  // ------------------------------------------------------------------ sources

  list(): KnowledgeSource[] {
    return (this.db.prepare('SELECT * FROM knowledge_sources ORDER BY created_at DESC').all() as SourceRow[]).map(rowToSource)
  }

  get(id: string): KnowledgeSource | null {
    const r = this.db.prepare('SELECT * FROM knowledge_sources WHERE id = ?').get(id) as SourceRow | undefined
    return r ? rowToSource(r) : null
  }

  async add(path: string, name?: string): Promise<KnowledgeSource> {
    const st = await fs.stat(path)
    const kind: KnowledgeSource['kind'] = st.isDirectory() ? 'folder' : 'file'
    if (kind === 'file' && !TEXT_EXT.has(extname(path).toLowerCase())) throw new Error(`Unsupported file type ${extname(path) || '(none)'} — add plain-text/markdown/code files, or a folder.`)
    const id = randomUUID()
    const now = Date.now()
    this.db
      .prepare('INSERT INTO knowledge_sources (id, name, kind, path, files, chunks, embed_model, status, error, created_at, updated_at) VALUES (?, ?, ?, ?, 0, 0, NULL, ?, NULL, ?, ?)')
      .run(id, name?.trim() || basename(path) || path, kind, path, 'idle', now, now)
    void this.reindex(id).catch(() => {})
    return this.get(id)!
  }

  remove(id: string): boolean {
    this.cache.delete(id)
    this.db.prepare('DELETE FROM knowledge_chunks WHERE source_id = ?').run(id)
    const r = this.db.prepare('DELETE FROM knowledge_sources WHERE id = ?').run(id)
    return r.changes > 0
  }

  isIndexing(id: string): boolean {
    return this.indexing.has(id)
  }

  private setStatus(id: string, patch: Partial<Pick<SourceRow, 'files' | 'chunks' | 'embed_model' | 'status' | 'error'>>): void {
    const cur = this.db.prepare('SELECT * FROM knowledge_sources WHERE id = ?').get(id) as SourceRow | undefined
    if (!cur) return
    const next = { ...cur, ...patch, updated_at: Date.now() }
    this.db.prepare('UPDATE knowledge_sources SET files=?, chunks=?, embed_model=?, status=?, error=?, updated_at=? WHERE id=?').run(next.files, next.chunks, next.embed_model, next.status, next.error, next.updated_at, id)
    this.emit('source', rowToSource(next as SourceRow))
  }

  private progress(p: KnowledgeProgress): void {
    this.emit('progress', p)
  }

  // ------------------------------------------------------------------ indexing

  async reindex(id: string): Promise<void> {
    const src = this.get(id)
    if (!src) throw new Error('source not found')
    if (this.indexing.has(id)) return
    this.indexing.add(id)
    this.cache.delete(id)
    try {
      this.setStatus(id, { status: 'indexing', error: null })
      this.progress({ sourceId: id, phase: 'scanning', files: 0, chunks: 0, done: 0 })
      const files = await this.collectFiles(src)
      // chunk everything first so we can report totals
      const all: { file: string; ord: number; text: string }[] = []
      for (const f of files) {
        let text: string
        try {
          text = await fs.readFile(f.abs, 'utf8')
        } catch {
          continue
        }
        if (text.includes('\u0000')) continue // binary sniff
        chunkText(text).forEach((t, i) => all.push({ file: f.rel, ord: i, text: t }))
      }
      this.db.prepare('DELETE FROM knowledge_chunks WHERE source_id = ?').run(id)
      this.setStatus(id, { files: files.length, chunks: all.length })
      this.progress({ sourceId: id, phase: 'embedding', files: files.length, chunks: all.length, done: 0 })
      const insert = this.db.prepare('INSERT INTO knowledge_chunks (source_id, file, ord, text, embedding, dims, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      let done = 0
      let embedModel: string | null = null
      for (let i = 0; i < all.length; i += EMBED_BATCH) {
        const batch = all.slice(i, i + EMBED_BATCH)
        const { vectors, model, dims } = await this.embed(batch.map((b) => `${b.file}\n${b.text}`), 'document')
        embedModel = model
        const tx = this.db.transaction(() => {
          batch.forEach((b, j) => insert.run(id, b.file, b.ord, b.text, Buffer.from(vectors[j].buffer, vectors[j].byteOffset, vectors[j].byteLength), dims, Date.now()))
        })
        tx()
        done += batch.length
        this.progress({ sourceId: id, phase: 'embedding', files: files.length, chunks: all.length, done })
      }
      this.setStatus(id, { status: 'ready', files: files.length, chunks: all.length, embed_model: embedModel, error: null })
      this.progress({ sourceId: id, phase: 'ready', files: files.length, chunks: all.length, done })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.setStatus(id, { status: 'error', error: message })
      this.progress({ sourceId: id, phase: 'error', files: 0, chunks: 0, done: 0, message })
      throw err
    } finally {
      this.indexing.delete(id)
    }
  }

  private async collectFiles(src: KnowledgeSource): Promise<{ abs: string; rel: string }[]> {
    if (src.kind === 'file') return [{ abs: src.path, rel: basename(src.path) }]
    const out: { abs: string; rel: string }[] = []
    const walk = async (dir: string): Promise<void> => {
      if (out.length >= MAX_FILES) return
      let entries: import('node:fs').Dirent[]
      try {
        entries = await fs.readdir(dir, { withFileTypes: true })
      } catch {
        return
      }
      for (const e of entries) {
        if (out.length >= MAX_FILES) return
        const abs = join(dir, e.name)
        if (e.isDirectory()) {
          if (SKIP_DIRS.has(e.name) || e.name.startsWith('.')) continue
          await walk(abs)
        } else if (e.isFile()) {
          if (!TEXT_EXT.has(extname(e.name).toLowerCase())) continue
          try {
            const st = await fs.stat(abs)
            if (st.size > MAX_FILE_BYTES || st.size === 0) continue
          } catch {
            continue
          }
          out.push({ abs, rel: relative(src.path, abs).replace(/\\/g, '/') })
        }
      }
    }
    await walk(src.path)
    return out
  }

  // ------------------------------------------------------------------ embeddings

  private async embed(texts: string[], kind: 'document' | 'query'): Promise<{ vectors: Float32Array[]; model: string; dims: number }> {
    if (this.sidecar.status().state !== 'running') throw new Error('The NPU sidecar is not running — start it from the Studio page.')
    const res = await this.sidecar.fetch('/v1/embeddings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ input: texts, kind }), timeoutMs: 10 * 60_000 })
    const j = (await res.json().catch(() => ({}))) as { data?: { embedding: number[] }[]; model?: string; dims?: number; detail?: string; error?: string }
    if (!res.ok) throw new Error(j.detail ?? j.error ?? `embeddings failed (${res.status})`)
    const vectors = (j.data ?? []).map((d) => Float32Array.from(d.embedding))
    if (vectors.length !== texts.length) throw new Error('embedding count mismatch')
    return { vectors, model: j.model ?? 'nomic-embed-text', dims: j.dims ?? vectors[0]?.length ?? 0 }
  }

  private load(sourceId: string) {
    const cached = this.cache.get(sourceId)
    if (cached) return cached
    const rows = this.db.prepare('SELECT id, source_id, file, ord, text, embedding, dims FROM knowledge_chunks WHERE source_id = ? AND embedding IS NOT NULL ORDER BY id').all(sourceId) as ChunkRow[]
    const dims = rows[0]?.dims ?? 0
    const matrix = new Float32Array(rows.length * dims)
    const ids = new Int32Array(rows.length)
    const ords = new Int32Array(rows.length)
    const files: string[] = []
    const texts: string[] = []
    rows.forEach((r, i) => {
      ids[i] = r.id
      ords[i] = r.ord
      files.push(r.file)
      texts.push(r.text)
      if (r.embedding && dims) {
        const v = new Float32Array(r.embedding.buffer, r.embedding.byteOffset, dims)
        matrix.set(v, i * dims)
      }
    })
    const entry = { ids, files, ords, texts, matrix, dims }
    this.cache.set(sourceId, entry)
    return entry
  }

  // ------------------------------------------------------------------ search

  async search(query: string, opts: { topK?: number; sourceIds?: string[]; minScore?: number } = {}): Promise<KnowledgeHit[]> {
    const q = query.trim()
    if (!q) return []
    const sources = this.list().filter((s) => s.status === 'ready' && s.chunks > 0 && (!opts.sourceIds?.length || opts.sourceIds.includes(s.id)))
    if (!sources.length) return []
    const { vectors } = await this.embed([q], 'query')
    const qv = vectors[0]
    const topK = opts.topK ?? 6
    const minScore = opts.minScore ?? 0.35
    const hits: KnowledgeHit[] = []
    for (const s of sources) {
      const e = this.load(s.id)
      if (!e.dims || e.dims !== qv.length) continue
      for (let i = 0; i < e.ids.length; i++) {
        let dot = 0
        const off = i * e.dims
        for (let d = 0; d < e.dims; d++) dot += e.matrix[off + d] * qv[d]
        if (dot < minScore) continue
        hits.push({ chunkId: e.ids[i], sourceId: s.id, sourceName: s.name, file: e.files[i], ord: e.ords[i], text: e.texts[i], score: dot })
      }
    }
    hits.sort((a, b) => b.score - a.score)
    // de-duplicate adjacent overlapping chunks from the same file (keep the best)
    const seen = new Set<string>()
    const out: KnowledgeHit[] = []
    for (const h of hits) {
      const key = `${h.sourceId}:${h.file}:${Math.floor(h.ord / 2)}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push(h)
      if (out.length >= topK) break
    }
    return out
  }

  /** True when at least one source is ready to answer from. */
  hasReadySources(): boolean {
    return this.list().some((s) => s.status === 'ready' && s.chunks > 0)
  }

  /** Format hits as a numbered prompt section the model can cite as [n]. */
  static formatSection(hits: KnowledgeHit[], maxChars = 6000): string {
    const lines: string[] = [
      'Knowledge base excerpts retrieved for the latest user message. Use them when relevant and cite as [n]. If they do not answer the question, say so rather than guessing.',
      '',
    ]
    let used = 0
    hits.forEach((h, i) => {
      const body = h.text.length > 1500 ? `${h.text.slice(0, 1500)}…` : h.text
      const block = `[${i + 1}] ${h.sourceName} › ${h.file}\n${body}\n`
      if (used + block.length > maxChars) return
      used += block.length
      lines.push(block)
    })
    return lines.join('\n')
  }
}
