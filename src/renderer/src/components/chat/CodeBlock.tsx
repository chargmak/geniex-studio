import { useEffect, useMemo, useState } from 'react'
import { Check, Copy, Eye, WrapText } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useUiStore } from '@/stores/uiStore'
import { useArtifactStore } from '@/stores/artifactStore'

type Highlighter = { codeToHtml: (code: string, opts: { lang: string; theme: string }) => string; getLoadedLanguages: () => string[]; loadLanguage: (l: string) => Promise<void> }
let highlighterPromise: Promise<Highlighter> | null = null

const CORE_LANGS = ['ts', 'tsx', 'js', 'jsx', 'json', 'bash', 'shell', 'powershell', 'python', 'html', 'css', 'md', 'yaml', 'sql', 'diff', 'c', 'cpp', 'rust', 'go', 'java', 'kotlin', 'csharp', 'toml', 'xml', 'dockerfile', 'ini']

async function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = (async () => {
      const { createHighlighter } = await import('shiki/bundle/web')
      const h = await createHighlighter({ themes: ['github-dark-default', 'github-light-default'], langs: CORE_LANGS })
      return h as unknown as Highlighter
    })()
  }
  return highlighterPromise
}

const LANG_ALIASES: Record<string, string> = { sh: 'bash', zsh: 'bash', ps1: 'powershell', ps: 'powershell', py: 'python', yml: 'yaml', jsonc: 'json', htm: 'html', 'c++': 'cpp', cs: 'csharp', text: 'text', txt: 'text', plaintext: 'text', mermaid: 'text', console: 'bash' }

export function CodeBlock({ code, lang, className }: { code: string; lang?: string; className?: string }): React.JSX.Element {
  const theme = useUiStore((s) => s.theme)
  const [html, setHtml] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [wrap, setWrap] = useState(false)
  const language = useMemo(() => {
    const l = (lang ?? '').toLowerCase()
    return LANG_ALIASES[l] ?? l ?? 'text'
  }, [lang])

  useEffect(() => {
    let cancelled = false
    if (!language || language === 'text' || code.length > 60_000) {
      setHtml(null)
      return
    }
    void getHighlighter()
      .then(async (h) => {
        if (!h.getLoadedLanguages().includes(language)) {
          try {
            await h.loadLanguage(language)
          } catch {
            return null
          }
        }
        return h.codeToHtml(code, { lang: language, theme: theme === 'dark' ? 'github-dark-default' : 'github-light-default' })
      })
      .then((out) => {
        if (!cancelled) setHtml(out ?? null)
      })
      .catch(() => {
        if (!cancelled) setHtml(null)
      })
    return () => {
      cancelled = true
    }
  }, [code, language, theme])

  const showArtifact = useArtifactStore((s) => s.show)
  const previewKind = language === 'html' ? 'html' : language === 'svg' || (language === 'xml' && /^\s*<svg[\s>]/i.test(code)) ? 'svg' : null

  const copy = async (): Promise<void> => {
    await navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 1400)
  }

  return (
    <div className={cn('group/code my-3 overflow-hidden rounded-md hairline-subtle bg-surface-2', className)}>
      <div className="flex h-8 items-center justify-between px-3 hairline-b bg-surface-3/60">
        <span className="metadata-sm text-text-secondary">{language && language !== 'text' ? language : 'text'}</span>
        <div className="flex items-center gap-1">
          {previewKind && (
            <button
              type="button"
              onClick={() => showArtifact({ id: `${previewKind}-${code.length}`, kind: previewKind, title: `${previewKind.toUpperCase()} preview`, code })}
              className="flex h-6 items-center gap-1 rounded-sm px-1.5 text-xs text-accent-brand hover:bg-surface-4"
              title="Open live preview"
            >
              <Eye className="size-3.5" /> Preview
            </button>
          )}
          <button type="button" onClick={() => setWrap((w) => !w)} className={cn('flex size-6 items-center justify-center rounded-sm text-text-secondary hover:bg-surface-4 hover:text-text-primary', wrap && 'text-accent-brand')} aria-label="Toggle wrap" title="Toggle line wrap">
            <WrapText className="size-3.5" />
          </button>
          <button type="button" onClick={() => void copy()} className="flex size-6 items-center justify-center rounded-sm text-text-secondary hover:bg-surface-4 hover:text-text-primary" aria-label="Copy code" title="Copy">
            {copied ? <Check className="size-3.5 text-positive" /> : <Copy className="size-3.5" />}
          </button>
        </div>
      </div>
      {html ? (
        <div
          className={cn('code-sm overflow-x-auto p-3 [&_pre]:!bg-transparent [&_pre]:!m-0 [&_code]:!bg-transparent', wrap && '[&_pre]:whitespace-pre-wrap [&_pre]:break-words')}
          // shiki output is generated from escaped code — safe to inject.
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <pre className={cn('code-sm overflow-x-auto p-3 text-text-primary', wrap && 'whitespace-pre-wrap break-words')}>
          <code>{code}</code>
        </pre>
      )}
    </div>
  )
}
