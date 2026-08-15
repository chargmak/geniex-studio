import { useMemo, useState } from 'react'
import { Code2, Copy, Download, Eye, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useArtifactStore } from '@/stores/artifactStore'
import { Button } from '@/components/ui/button'
import { CodeBlock } from './CodeBlock'

/**
 * Sandboxed live preview for HTML / SVG produced by the model. The iframe has no `allow-same-origin` and no
 * network beyond what CSP permits, so generated content cannot reach the Studio API or the file system.
 */
export function ArtifactPanel(): React.JSX.Element | null {
  const open = useArtifactStore((s) => s.open)
  const artifact = useArtifactStore((s) => s.current)
  const close = useArtifactStore((s) => s.close)
  const [tab, setTab] = useState<'preview' | 'code'>('preview')

  const srcDoc = useMemo(() => {
    if (!artifact) return ''
    if (artifact.kind === 'svg') {
      return `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;height:100%;display:grid;place-items:center;background:#fff}svg{max-width:100%;max-height:100%}</style></head><body>${artifact.code}</body></html>`
    }
    return artifact.code
  }, [artifact])

  if (!open || !artifact) return null

  const download = (): void => {
    const blob = new Blob([artifact.code], { type: artifact.kind === 'svg' ? 'image/svg+xml' : 'text/html' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${artifact.title.replace(/[^\w.-]+/g, '-') || 'artifact'}.${artifact.kind === 'svg' ? 'svg' : 'html'}`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <aside className="flex h-full w-[46%] min-w-[380px] shrink-0 flex-col bg-surface-1 hairline-l">
      <div className="flex h-10 items-center gap-2 px-3 hairline-b">
        <span className="truncate text-[13px] font-medium text-text-primary">{artifact.title}</span>
        <div className="ml-2 flex h-7 items-center rounded-sm bg-surface-3 p-0.5 hairline-subtle">
          <button type="button" onClick={() => setTab('preview')} className={cn('flex h-6 items-center gap-1 rounded-xs px-2 text-xs', tab === 'preview' ? 'bg-surface-1 text-text-primary shadow-1' : 'text-text-secondary')}>
            <Eye className="size-3" /> Preview
          </button>
          <button type="button" onClick={() => setTab('code')} className={cn('flex h-6 items-center gap-1 rounded-xs px-2 text-xs', tab === 'code' ? 'bg-surface-1 text-text-primary shadow-1' : 'text-text-secondary')}>
            <Code2 className="size-3" /> Code
          </button>
        </div>
        <div className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="iconSm" onClick={() => void navigator.clipboard.writeText(artifact.code)} aria-label="Copy">
            <Copy />
          </Button>
          <Button variant="ghost" size="iconSm" onClick={download} aria-label="Download">
            <Download />
          </Button>
          <Button variant="ghost" size="iconSm" onClick={close} aria-label="Close preview">
            <X />
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {tab === 'preview' ? (
          <iframe title={artifact.title} sandbox="allow-scripts allow-forms allow-modals allow-popups" srcDoc={srcDoc} className="h-full w-full border-0 bg-white" />
        ) : (
          <div className="h-full overflow-auto p-3">
            <CodeBlock code={artifact.code} lang={artifact.kind === 'svg' ? 'xml' : 'html'} className="my-0" />
          </div>
        )}
      </div>
    </aside>
  )
}
