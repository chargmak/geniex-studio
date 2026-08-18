import { useEffect, useState } from 'react'
import { AlertTriangle, BookOpen, FileText, Folder, FolderPlus, Loader2, RefreshCw, Search, Trash2 } from 'lucide-react'
import { Link } from 'react-router'
import type { KnowledgeSource } from '@shared/sidecar'
import { cn, formatDuration } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useKnowledgeStore } from '@/stores/knowledgeStore'
import { useSidecarStore } from '@/stores/sidecarStore'

/**
 * Knowledge: local folders/files → chunks → nomic-embed-text on the NPU → cosine retrieval that the chat injects as
 * cited excerpts when "Knowledge" is toggled on in the composer. Everything stays on this machine.
 */
export function KnowledgePage(): React.JSX.Element {
  const sources = useKnowledgeStore((s) => s.sources)
  const subscribe = useKnowledgeStore((s) => s.subscribe)
  const loaded = useKnowledgeStore((s) => s.loaded)
  const error = useKnowledgeStore((s) => s.error)
  const addSource = useKnowledgeStore((s) => s.addSource)
  const sidecar = useSidecarStore((s) => s.status)
  const subscribeSidecar = useSidecarStore((s) => s.subscribe)
  useEffect(() => {
    const a = subscribe()
    const b = subscribeSidecar()
    return () => {
      a()
      b()
    }
  }, [subscribe, subscribeSidecar])

  const running = sidecar?.state === 'running'
  const embedReady = !!sidecar?.features?.embeddings
  const embedModel = sidecar?.models?.find((m) => m.feature === 'embeddings')
  const [manualPath, setManualPath] = useState('')
  const [adding, setAdding] = useState<string | null>(null)

  const add = async (path: string): Promise<void> => {
    if (!path.trim()) return
    setAdding(null)
    try {
      await addSource(path.trim())
      setManualPath('')
    } catch (err) {
      setAdding(err instanceof Error ? err.message : String(err))
    }
  }
  const pick = async (kind: 'folder' | 'file'): Promise<void> => {
    if (!window.studio?.showOpenDialog) return
    const paths = await window.studio.showOpenDialog({ title: kind === 'folder' ? 'Choose a folder to index' : 'Choose text files to index', properties: kind === 'folder' ? ['openDirectory'] : ['openFile', 'multiSelections'] })
    for (const p of paths) await add(p)
  }

  return (
    <div className="h-full min-h-0 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-4">
        <div className="rounded-md bg-surface-2 p-4 hairline-subtle">
          <div className="flex flex-wrap items-start gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-surface-3 hairline-subtle">
              <BookOpen className="size-4 text-accent-brand" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="heading-xs text-text-primary">Knowledge</span>
                <Badge variant={embedReady ? 'positive' : running ? 'warning' : 'neutral'}>
                  {embedReady ? 'embeddings on NPU' : running ? 'embedding model missing' : sidecar?.state === 'not-installed' ? 'sidecar not installed' : `sidecar ${sidecar?.state ?? 'stopped'}`}
                </Badge>
              </div>
              <p className="mt-1 body-sm text-text-secondary">
                Index folders of notes, docs or code. Text is split into overlapping chunks and embedded with nomic-embed-text on the Hexagon NPU; when you switch on <em>Knowledge</em> in the chat composer, the best-matching excerpts are added to the prompt with numbered citations. Supported: Markdown, plain text, code, JSON/YAML/CSV. PDFs and Office files are not parsed.
              </p>
              {!embedReady && (
                <p className="mt-2 body-sm text-warning">
                  {running ? (
                    <>
                      Download the embedding model ({embedModel?.name ?? 'nomic-embed-text'}) on the <Link className="underline" to="/studio">Studio</Link> page first.
                    </>
                  ) : (
                    <>
                      Start the NPU sidecar on the <Link className="underline" to="/studio">Studio</Link> page to index or search.
                    </>
                  )}
                </p>
              )}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {window.studio?.showOpenDialog && (
                  <>
                    <Button size="sm" onClick={() => void pick('folder')} disabled={!embedReady}>
                      <FolderPlus className="size-4" /> Add folder
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => void pick('file')} disabled={!embedReady}>
                      <FileText className="size-4" /> Add files
                    </Button>
                  </>
                )}
                <input
                  value={manualPath}
                  onChange={(e) => setManualPath(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && void add(manualPath)}
                  placeholder="…or paste a folder / file path and press Enter"
                  className="h-8 min-w-64 flex-1 rounded-sm bg-surface-1 px-2 text-[13px] text-text-primary outline-none hairline-subtle focus:hairline-strong"
                  disabled={!embedReady}
                />
              </div>
              {adding && <p className="mt-2 body-sm text-negative">{adding}</p>}
            </div>
          </div>
        </div>

        <div className="rounded-md bg-surface-2 hairline-subtle">
          <div className="flex items-center justify-between px-4 py-3">
            <span className="heading-xs text-text-primary">Sources</span>
            <span className="metadata-sm text-text-disabled">{sources.length} source{sources.length === 1 ? '' : 's'}</span>
          </div>
          {error && (
            <div className="mx-4 mb-3 flex items-start gap-2 rounded-md bg-negative-soft px-3 py-2 text-sm text-negative hairline-subtle">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {error}
            </div>
          )}
          {loaded && sources.length === 0 ? (
            <div className="px-4 pb-6 pt-2 text-center body-sm text-text-secondary">No sources yet — add a folder of notes or documentation to get started.</div>
          ) : (
            <ul className="divide-y divide-border-subtle">
              {sources.map((s) => (
                <SourceRow key={s.id} source={s} />
              ))}
            </ul>
          )}
        </div>

        <SearchCard disabled={!embedReady} />
      </div>
    </div>
  )
}

function SourceRow({ source }: { source: KnowledgeSource }): React.JSX.Element {
  const progress = useKnowledgeStore((s) => s.progress[source.id])
  const removeSource = useKnowledgeStore((s) => s.removeSource)
  const reindex = useKnowledgeStore((s) => s.reindex)
  const indexing = source.status === 'indexing'
  const pct = progress && progress.chunks > 0 ? Math.round((progress.done / progress.chunks) * 100) : null
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <div className="flex size-8 shrink-0 items-center justify-center rounded-sm bg-surface-3 hairline-subtle">{source.kind === 'folder' ? <Folder className="size-4 text-text-secondary" /> : <FileText className="size-4 text-text-secondary" />}</div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-[13px] font-medium text-text-primary">{source.name}</span>
          <Badge variant={source.status === 'ready' ? 'positive' : indexing ? 'initializing' : source.status === 'error' ? 'negative' : 'neutral'}>{indexing && pct != null ? `indexing ${pct}%` : source.status}</Badge>
        </div>
        <div className="mt-0.5 truncate metadata-sm text-text-disabled" title={source.path}>
          {source.path}
        </div>
        <div className="mt-0.5 metadata-sm text-text-secondary">
          {source.files} file{source.files === 1 ? '' : 's'} · {source.chunks} chunk{source.chunks === 1 ? '' : 's'}
          {source.embedModel && ` · ${source.embedModel}`}
          {source.status === 'error' && source.error && <span className="text-negative"> · {source.error}</span>}
        </div>
        {indexing && (
          <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-surface-3">
            <div className={cn('h-full rounded-full bg-accent-brand transition-[width]', pct == null && 'animate-pulse')} style={{ width: `${pct ?? 30}%` }} />
          </div>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button size="iconSm" variant="ghost" onClick={() => void reindex(source.id)} disabled={indexing} aria-label="Re-index">
          {indexing ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
        </Button>
        <Button size="iconSm" variant="ghost" onClick={() => void removeSource(source.id)} aria-label="Remove">
          <Trash2 className="size-4" />
        </Button>
      </div>
    </li>
  )
}

function SearchCard({ disabled }: { disabled: boolean }): React.JSX.Element {
  const [q, setQ] = useState('')
  const search = useKnowledgeStore((s) => s.search)
  const searching = useKnowledgeStore((s) => s.searching)
  const results = useKnowledgeStore((s) => s.results)
  const ready = useKnowledgeStore((s) => s.ready)
  return (
    <div className="rounded-md bg-surface-2 p-4 hairline-subtle">
      <div className="flex items-center gap-2">
        <Search className="size-4 text-text-secondary" />
        <span className="heading-xs text-text-primary">Try a search</span>
        <span className="metadata-sm text-text-disabled">semantic retrieval, top 6</span>
      </div>
      <div className="mt-3 flex gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && q.trim() && void search(q)}
          placeholder={ready ? 'What would you like to find?' : 'Add and index a source first'}
          disabled={disabled || !ready}
          className="h-9 flex-1 rounded-sm bg-surface-1 px-3 text-[13px] text-text-primary outline-none hairline-subtle focus:hairline-strong"
        />
        <Button onClick={() => void search(q)} disabled={disabled || !ready || !q.trim() || searching}>
          {searching ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />} Search
        </Button>
      </div>
      {results && (
        <div className="mt-3">
          <div className="metadata-sm text-text-disabled">
            {results.hits.length} hit{results.hits.length === 1 ? '' : 's'} for “{results.query}” in {formatDuration(results.durationMs)}
          </div>
          <ul className="mt-2 flex flex-col gap-2">
            {results.hits.map((h, i) => (
              <li key={h.chunkId} className="rounded-md bg-surface-1 p-3 hairline-subtle">
                <div className="flex flex-wrap items-center gap-2 metadata-sm">
                  <span className="rounded-sm bg-accent-soft px-1.5 text-accent-brand">[{i + 1}]</span>
                  <span className="text-text-primary">{h.sourceName}</span>
                  <span className="text-text-disabled">›</span>
                  <span className="truncate text-text-secondary">{h.file}</span>
                  <span className="ml-auto text-text-disabled">score {h.score.toFixed(3)}</span>
                </div>
                <pre className="mt-1.5 max-h-40 overflow-auto whitespace-pre-wrap break-words font-sans text-[13px] leading-relaxed text-text-secondary">{h.text}</pre>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
