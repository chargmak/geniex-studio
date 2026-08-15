import { useEffect, useId, useState } from 'react'
import { useUiStore } from '@/stores/uiStore'
import { CodeBlock } from './CodeBlock'

let mermaidPromise: Promise<typeof import('mermaid')['default']> | null = null
async function getMermaid(): Promise<typeof import('mermaid')['default']> {
  if (!mermaidPromise) mermaidPromise = import('mermaid').then((m) => m.default)
  return mermaidPromise
}

/** Renders a ```mermaid block; falls back to the raw code on parse errors. */
export function Mermaid({ code }: { code: string }): React.JSX.Element {
  const theme = useUiStore((s) => s.theme)
  const id = useId().replace(/[:]/g, '_')
  const [svg, setSvg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void getMermaid()
      .then(async (m) => {
        m.initialize({
          startOnLoad: false,
          theme: theme === 'dark' ? 'dark' : 'default',
          securityLevel: 'strict',
          fontFamily: 'Roboto Flex Variable, Roboto Flex, sans-serif',
          themeVariables: theme === 'dark' ? { primaryColor: '#283c97', primaryTextColor: '#fffffff2', lineColor: '#7ba0ff', background: '#202021' } : { primaryColor: '#dee7ff', primaryTextColor: '#000000f2', lineColor: '#3253dc' },
        })
        const { svg: out } = await m.render(`mmd_${id}`, code)
        if (!cancelled) {
          setSvg(out)
          setError(null)
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      cancelled = true
    }
  }, [code, theme, id])

  if (error) return <CodeBlock code={code} lang="mermaid" />
  if (!svg) return <div className="my-3 rounded-md p-4 hairline-subtle bg-surface-2 text-xs text-text-secondary">Rendering diagram…</div>
  return <div className="my-3 overflow-x-auto rounded-md p-3 hairline-subtle bg-surface-2 [&_svg]:mx-auto [&_svg]:max-w-full" dangerouslySetInnerHTML={{ __html: svg }} />
}
