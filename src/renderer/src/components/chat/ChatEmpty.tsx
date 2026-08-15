import { Link } from 'react-router'
import { Boxes, Code2, Eye, FileText, Lightbulb } from 'lucide-react'
import { BrandMark } from '@/components/shell/BrandMark'
import { cn } from '@/lib/utils'

const SUGGESTIONS = [
  { icon: Lightbulb, title: 'Explain a concept', prompt: 'Explain how a Hexagon NPU accelerates LLM inference, in plain terms.' },
  { icon: Code2, title: 'Write code', prompt: 'Write a TypeScript function that debounces an async function and cancels stale calls.' },
  { icon: FileText, title: 'Summarize', prompt: 'Summarize the following text into five bullet points:\n\n' },
  { icon: Eye, title: 'Describe an image', prompt: 'Describe this image in detail and list any text you can read in it.', vision: true },
]

export function ChatEmpty({ hasModels, onPick, isVlm }: { hasModels: boolean; onPick: (prompt: string) => void; isVlm: boolean }): React.JSX.Element {
  return (
    <div className="flex h-full flex-col items-center justify-center px-6">
      <div className="mx-auto w-full max-w-[var(--q-prose-max)]">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-4 flex size-12 items-center justify-center rounded-lg bg-surface-2 hairline-subtle">
            <BrandMark size={26} />
          </div>
          <h2 className="heading-md text-text-primary">What can I help with?</h2>
          <p className="mt-1.5 max-w-md body-sm text-text-secondary">Everything runs on this device — on the Hexagon NPU when the model allows. Pick a model in the composer, then ask away.</p>
        </div>
        {hasModels ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {SUGGESTIONS.map((s) => (
              <button
                key={s.title}
                type="button"
                onClick={() => onPick(s.prompt)}
                className={cn('flex flex-col items-start gap-2 rounded-md bg-surface-2 p-3 text-left hairline-subtle transition-colors hover:bg-surface-3', s.vision && !isVlm && 'opacity-60')}
                title={s.vision && !isVlm ? 'Pick a Vision model to use this' : undefined}
              >
                <s.icon className="size-4 text-accent-brand" />
                <span className="text-[13px] font-medium text-text-primary">{s.title}</span>
                <span className="line-clamp-2 text-xs text-text-secondary">{s.prompt}</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="rounded-md bg-surface-2 p-5 text-center hairline-subtle">
            <Boxes className="mx-auto mb-2 size-6 text-text-secondary" />
            <div className="heading-xs text-text-primary">No models installed yet</div>
            <p className="mt-1 body-sm text-text-secondary">Pull a model from the Qualcomm AI Hub catalogue or Hugging Face to start chatting.</p>
            <Link to="/models" className="mt-3 inline-flex h-9 items-center rounded-sm bg-accent-brand px-4 text-sm font-medium text-accent-fg hover:bg-accent-strong">
              Open Models
            </Link>
          </div>
        )}
      </div>
    </div>
  )
}
