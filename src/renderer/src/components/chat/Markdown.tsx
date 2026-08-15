import { memo, type ComponentProps } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { cn } from '@/lib/utils'
import { CodeBlock } from './CodeBlock'
import { Mermaid } from './Mermaid'

function extractText(children: React.ReactNode): string {
  if (typeof children === 'string') return children
  if (Array.isArray(children)) return children.map(extractText).join('')
  if (children && typeof children === 'object' && 'props' in children) return extractText((children as { props: { children?: React.ReactNode } }).props.children)
  return ''
}

const components: ComponentProps<typeof ReactMarkdown>['components'] = {
  pre({ children }) {
    // Rendered by `code` below (block variant); avoid double wrappers.
    return <>{children}</>
  },
  code({ className, children, ...props }) {
    const match = /language-([\w+-]+)/.exec(className ?? '')
    const text = extractText(children).replace(/\n$/, '')
    const isBlock = !!match || text.includes('\n')
    if (!isBlock) {
      return (
        <code className="rounded-xs bg-surface-3 px-1 py-0.5 code-xs text-text-primary" {...props}>
          {children}
        </code>
      )
    }
    const lang = match?.[1]
    if (lang === 'mermaid') return <Mermaid code={text} />
    return <CodeBlock code={text} lang={lang ?? (/^\s*<svg[\s>]/i.test(text) ? 'svg' : /^\s*<!doctype html|^\s*<html/i.test(text) ? 'html' : undefined)} />
  },
  a({ href, children }) {
    const external = /^https?:\/\//i.test(href ?? '')
    return (
      <a
        href={href}
        target={external ? '_blank' : undefined}
        rel={external ? 'noreferrer noopener' : undefined}
        className="text-accent-brand underline decoration-[color-mix(in_srgb,var(--accent)_45%,transparent)] underline-offset-2 hover:decoration-[var(--accent)]"
        onClick={(e) => {
          if (external && window.studio?.openExternal) {
            e.preventDefault()
            void window.studio.openExternal(href!)
          }
        }}
      >
        {children}
      </a>
    )
  },
  table({ children }) {
    return (
      <div className="my-3 overflow-x-auto rounded-md hairline-subtle">
        <table className="w-full border-collapse text-sm">{children}</table>
      </div>
    )
  },
  th({ children }) {
    return <th className="bg-surface-3 px-3 py-1.5 text-left metadata-md text-text-secondary hairline-b">{children}</th>
  },
  td({ children }) {
    return <td className="px-3 py-1.5 align-top hairline-b [tr:last-child_&]:border-b-0">{children}</td>
  },
  blockquote({ children }) {
    return <blockquote className="my-3 border-l-2 border-[var(--accent)] pl-3 text-text-secondary">{children}</blockquote>
  },
  hr() {
    return <hr className="my-4 hairline-b" />
  },
  img({ src, alt }) {
    return <img src={src} alt={alt ?? ''} className="my-2 max-h-96 max-w-full rounded-md hairline-subtle" loading="lazy" />
  },
}

/** Product-grade markdown: GFM, syntax-highlighted code, mermaid, safe links (no raw HTML). */
export const Markdown = memo(function Markdown({ text, className }: { text: string; className?: string }): React.JSX.Element {
  return (
    <div
      className={cn(
        'prose-q body-md text-text-primary',
        '[&>*:first-child]:mt-0 [&>*:last-child]:mb-0',
        '[&_p]:my-2 [&_ul]:my-2 [&_ol]:my-2 [&_li]:my-0.5 [&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-5 [&_ol]:pl-5',
        '[&_h1]:heading-md [&_h1]:mt-5 [&_h1]:mb-2 [&_h2]:heading-sm [&_h2]:mt-4 [&_h2]:mb-2 [&_h3]:heading-xs [&_h3]:mt-3 [&_h3]:mb-1.5 [&_h4]:heading-xxs [&_h4]:mt-3 [&_h4]:mb-1',
        '[&_strong]:font-[560] [&_em]:italic',
        '[&_input[type=checkbox]]:mr-1.5 [&_input[type=checkbox]]:accent-[var(--accent)]',
        className,
      )}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components} skipHtml>
        {text}
      </ReactMarkdown>
    </div>
  )
})
