import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ArrowUp, Bot, Brain, FolderOpen, ImagePlus, MessageSquare, Paperclip, SlidersHorizontal, Square, X, Zap } from 'lucide-react'
import type { ComputeUnit } from '@shared/config'
import type { Attachment } from '@shared/chat'
import type { CachedModel, SamplerSettings } from '@shared/api'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ModelPicker } from './ModelPicker'

const MAX_H = 220

export interface ComposerSettings {
  enableThink: boolean
  compute: ComputeUnit
  sampler: SamplerSettings
}

const SLASH_COMMANDS: { cmd: string; hint: string; args?: string }[] = [
  { cmd: '/think', hint: 'Toggle thinking mode', args: 'on|off' },
  { cmd: '/compute', hint: 'Compute unit for GGUF models', args: 'npu|hybrid|gpu|cpu' },
  { cmd: '/system', hint: 'Set the system prompt for this chat', args: 'text' },
  { cmd: '/temp', hint: 'Sampling temperature', args: '0–2' },
  { cmd: '/max', hint: 'Max tokens per answer', args: 'n' },
  { cmd: '/regenerate', hint: 'Regenerate the last answer' },
]

export function Composer({
  model,
  modelInfo,
  onModelChange,
  settings,
  onSettingsChange,
  attachments,
  onRemoveAttachment,
  onFiles,
  onPickFiles,
  busy,
  onSend,
  onStop,
  onCommand,
  draft,
  onDraftChange,
  editing,
  onCancelEdit,
  disabledReason,
  mode,
  onModeChange,
  workspaceRoot,
  onPickWorkspace,
}: {
  model: string | null
  modelInfo: CachedModel | undefined
  onModelChange: (id: string) => void
  settings: ComposerSettings
  onSettingsChange: (patch: Partial<ComposerSettings>) => void
  attachments: Attachment[]
  onRemoveAttachment: (id: string) => void
  onFiles: (files: File[]) => void
  onPickFiles: () => void
  busy: boolean
  onSend: (text: string) => void
  onStop: () => void
  onCommand: (cmd: string, arg: string) => boolean
  draft: string
  onDraftChange: (v: string) => void
  editing: { id: string; preview: string } | null
  onCancelEdit: () => void
  disabledReason?: string | null
  mode: 'chat' | 'agent'
  onModeChange: (m: 'chat' | 'agent') => void
  workspaceRoot: string | null
  onPickWorkspace: () => void
}): React.JSX.Element {
  const taRef = useRef<HTMLTextAreaElement>(null)
  const [dragOver, setDragOver] = useState(false)
  const [slashIndex, setSlashIndex] = useState(0)
  const isVlm = modelInfo?.type === 'vlm'
  const isQairt = modelInfo?.runtime === 'qairt'
  const hasImages = attachments.some((a) => a.kind === 'image' || a.kind === 'audio')

  const slashOpen = draft.startsWith('/') && !draft.includes('\n') && !draft.includes(' ')
  const slashMatches = useMemo(() => (slashOpen ? SLASH_COMMANDS.filter((c) => c.cmd.startsWith(draft.toLowerCase())) : []), [draft, slashOpen])
  useEffect(() => setSlashIndex(0), [draft])

  useLayoutEffect(() => {
    const el = taRef.current
    if (!el) return
    el.style.height = '0px'
    el.style.height = `${Math.min(MAX_H, el.scrollHeight)}px`
    el.style.overflowY = el.scrollHeight > MAX_H ? 'auto' : 'hidden'
  }, [draft])

  useEffect(() => {
    if (editing) taRef.current?.focus()
  }, [editing])

  const submit = useCallback(() => {
    const text = draft.trim()
    if (busy) return
    if (text.startsWith('/')) {
      const [cmd, ...rest] = text.split(/\s+/)
      if (onCommand(cmd.toLowerCase(), rest.join(' '))) {
        onDraftChange('')
        return
      }
    }
    if (!text && !attachments.length) return
    onSend(text)
  }, [attachments.length, busy, draft, onCommand, onDraftChange, onSend])

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (slashOpen && slashMatches.length) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSlashIndex((i) => (i + 1) % slashMatches.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSlashIndex((i) => (i - 1 + slashMatches.length) % slashMatches.length)
        return
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && slashMatches[slashIndex]?.cmd !== draft)) {
        e.preventDefault()
        const pick = slashMatches[slashIndex]
        onDraftChange(pick.args ? `${pick.cmd} ` : pick.cmd)
        return
      }
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      submit()
    }
    if (e.key === 'Escape' && editing) onCancelEdit()
  }

  const onPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>): void => {
    const files = Array.from(e.clipboardData.files ?? [])
    if (files.length) {
      e.preventDefault()
      onFiles(files)
    }
  }

  const onDrop = (e: React.DragEvent): void => {
    e.preventDefault()
    setDragOver(false)
    const files = Array.from(e.dataTransfer.files ?? [])
    if (files.length) onFiles(files)
  }

  const canSend = (draft.trim().length > 0 || attachments.length > 0) && !busy && !disabledReason

  return (
    <div className="shrink-0 px-6 pb-4">
      <div className="mx-auto w-full max-w-[var(--q-prose-max)]">
        {editing && (
          <div className="mb-2 flex items-center justify-between rounded-md bg-surface-2 px-3 py-1.5 text-xs text-text-secondary hairline-subtle">
            <span className="truncate">
              Editing: <span className="text-text-primary">{editing.preview}</span> — later messages will be replaced
            </span>
            <button type="button" onClick={onCancelEdit} className="ml-2 text-text-secondary hover:text-text-primary">
              Cancel
            </button>
          </div>
        )}
        {hasImages && modelInfo && !isVlm && (
          <div className="mb-2 rounded-md bg-warning-soft px-3 py-1.5 text-xs text-warning hairline-subtle">
            <strong>{modelInfo.displayName}</strong> is a text-only model — attachments will be described but not seen. Pick a Vision model (e.g. Qwen3-VL) to analyse images.
          </div>
        )}
        <div
          onDragOver={(e) => {
            e.preventDefault()
            setDragOver(true)
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          className={cn(
            'relative rounded-lg bg-surface-2 hairline transition-[border-color,box-shadow] duration-(--q-transition-duration-fast)',
            'focus-within:border-[var(--border-strong)] focus-within:shadow-1',
            dragOver && 'border-[var(--accent)] bg-accent-soft/40',
          )}
        >
          {slashOpen && slashMatches.length > 0 && (
            <div className="absolute bottom-full left-2 mb-2 w-80 rounded-md bg-surface-3 p-1 shadow-3 hairline">
              {slashMatches.map((c, i) => (
                <button
                  key={c.cmd}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => onDraftChange(c.args ? `${c.cmd} ` : c.cmd)}
                  className={cn('flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-left text-sm', i === slashIndex ? 'bg-surface-4 text-text-primary' : 'text-text-secondary hover:bg-surface-4')}
                >
                  <span>
                    <span className="font-mono text-[13px] text-text-primary">{c.cmd}</span>
                    {c.args && <span className="ml-1.5 font-mono text-xs text-text-disabled">{c.args}</span>}
                  </span>
                  <span className="text-xs">{c.hint}</span>
                </button>
              ))}
            </div>
          )}

          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-2 px-3 pt-3">
              {attachments.map((a) => (
                <div key={a.id} className="group/att relative">
                  {a.kind === 'image' ? (
                    <img src={`/api/attachments/${a.id}/raw`} alt={a.name} className="size-16 rounded-md object-cover hairline-subtle" />
                  ) : (
                    <div className="flex h-16 max-w-48 items-center gap-2 rounded-md bg-surface-3 px-3 text-xs text-text-secondary hairline-subtle">
                      <Paperclip className="size-3.5" />
                      <span className="truncate">{a.name}</span>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => onRemoveAttachment(a.id)}
                    className="absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full bg-surface-4 text-text-secondary shadow-1 hairline hover:text-text-primary"
                    aria-label={`Remove ${a.name}`}
                  >
                    <X className="size-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <textarea
            ref={taRef}
            value={draft}
            onChange={(e) => onDraftChange(e.target.value)}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            rows={1}
            placeholder={disabledReason ?? (mode === 'agent' ? 'Describe a task — the agent can read/write files, run PowerShell, search the web…' : isVlm ? 'Ask anything, or drop an image…' : 'Ask anything… (type / for commands)')}
            disabled={!!disabledReason}
            className="block w-full resize-none bg-transparent px-4 pt-3 pb-2 body-md text-text-primary outline-none placeholder:text-text-disabled disabled:cursor-not-allowed"
            aria-label="Message"
          />

          <div className="flex items-center gap-1 px-2 pb-2">
            <div className="mr-1 flex h-8 items-center rounded-sm bg-surface-3 p-0.5 hairline-subtle" role="tablist" aria-label="Mode">
              <button type="button" role="tab" aria-selected={mode === 'chat'} onClick={() => onModeChange('chat')} className={cn('flex h-7 items-center gap-1 rounded-xs px-2 text-xs', mode === 'chat' ? 'bg-surface-1 text-text-primary shadow-1' : 'text-text-secondary hover:text-text-primary')}>
                <MessageSquare className="size-3.5" /> Chat
              </button>
              <button type="button" role="tab" aria-selected={mode === 'agent'} onClick={() => onModeChange('agent')} className={cn('flex h-7 items-center gap-1 rounded-xs px-2 text-xs', mode === 'agent' ? 'bg-surface-1 text-accent-brand shadow-1' : 'text-text-secondary hover:text-text-primary')}>
                <Bot className="size-3.5" /> Agent
              </button>
            </div>
            <ModelPicker value={model} onChange={onModelChange} compact />
            {mode === 'agent' && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button type="button" onClick={onPickWorkspace} className="inline-flex h-8 max-w-56 items-center gap-1.5 rounded-sm px-2 text-[13px] text-text-secondary hover:bg-surface-3">
                    <FolderOpen className="size-3.5" />
                    <span className="truncate">{workspaceRoot ? workspaceRoot.split(/[\\/]/).pop() : 'Pick workspace'}</span>
                  </button>
                </TooltipTrigger>
                <TooltipContent>Workspace folder the agent can read/write: {workspaceRoot ?? 'default'}</TooltipContent>
              </Tooltip>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => onSettingsChange({ enableThink: !settings.enableThink })}
                  className={cn('inline-flex h-8 items-center gap-1.5 rounded-sm px-2 text-[13px] text-text-secondary hover:bg-surface-3', settings.enableThink && 'bg-accent-soft text-accent-brand hover:bg-accent-soft')}
                  aria-pressed={settings.enableThink}
                >
                  <Brain className="size-3.5" />
                  <span className="hidden sm:inline">Think</span>
                </button>
              </TooltipTrigger>
              <TooltipContent>Thinking mode ({settings.enableThink ? 'on' : 'off'}) — reasoning models plan before answering</TooltipContent>
            </Tooltip>
            {!isQairt && (
              <Popover>
                <PopoverTrigger asChild>
                  <button type="button" className="inline-flex h-8 items-center gap-1.5 rounded-sm px-2 text-[13px] text-text-secondary hover:bg-surface-3">
                    <Zap className="size-3.5" />
                    <span className="uppercase metadata-sm">{settings.compute}</span>
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-64 p-1">
                  {(['npu', 'hybrid', 'gpu', 'cpu'] as ComputeUnit[]).map((cu) => (
                    <button
                      key={cu}
                      type="button"
                      onClick={() => onSettingsChange({ compute: cu })}
                      className={cn('flex w-full flex-col items-start rounded-sm px-2 py-1.5 text-left hover:bg-surface-4', settings.compute === cu && 'bg-accent-soft')}
                    >
                      <span className="text-[13px] font-medium uppercase text-text-primary">{cu}</span>
                      <span className="text-xs text-text-secondary">
                        {cu === 'npu' && 'Pinned to the Hexagon NPU — reliable default (Q4_0 GGUF; deterministic)'}
                        {cu === 'hybrid' && 'NPU + CPU scheduler — documented as fastest, but experimental: crashed on 4B models with low free RAM here'}
                        {cu === 'gpu' && 'Adreno GPU via OpenCL'}
                        {cu === 'cpu' && 'CPU only'}
                      </span>
                    </button>
                  ))}
                  <div className="px-2 py-1.5 text-[11px] text-text-disabled">Changing compute reloads the model. QAIRT bundles always run on the NPU.</div>
                </PopoverContent>
              </Popover>
            )}
            {isQairt && (
              <span className="inline-flex h-8 items-center gap-1.5 px-2 text-[13px] text-text-secondary">
                <Zap className="size-3.5 text-teal-300" />
                <span className="metadata-sm text-teal-300">NPU</span>
              </span>
            )}
            <SamplerPopover sampler={settings.sampler} onChange={(sampler) => onSettingsChange({ sampler })} />
            <div className="ml-auto flex items-center gap-1">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="iconSm" onClick={onPickFiles} aria-label="Attach image or file">
                    <ImagePlus />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Attach images (Vision models) — or paste / drop</TooltipContent>
              </Tooltip>
              {busy ? (
                <Button variant="secondary" size="iconSm" onClick={onStop} aria-label="Stop generating">
                  <Square className="size-3.5 fill-current" />
                </Button>
              ) : (
                <Button variant="primary" size="iconSm" onClick={submit} disabled={!canSend} aria-label="Send">
                  <ArrowUp />
                </Button>
              )}
            </div>
          </div>
        </div>
        <div className="mt-1.5 flex items-center justify-between px-1 text-[11px] text-text-disabled">
          <span>Enter to send · Shift+Enter for a new line · / for commands</span>
          <span>Runs locally on your Snapdragon — nothing leaves this device</span>
        </div>
      </div>
    </div>
  )
}

function SamplerPopover({ sampler, onChange }: { sampler: SamplerSettings; onChange: (s: SamplerSettings) => void }): React.JSX.Element {
  const rows: { key: keyof SamplerSettings; label: string; min: number; max: number; step: number; def: number }[] = [
    { key: 'temperature', label: 'Temperature', min: 0, max: 2, step: 0.05, def: 0.7 },
    { key: 'top_p', label: 'Top-p', min: 0, max: 1, step: 0.01, def: 0.9 },
    { key: 'top_k', label: 'Top-k', min: 0, max: 200, step: 1, def: 40 },
    { key: 'min_p', label: 'Min-p', min: 0, max: 1, step: 0.01, def: 0 },
    { key: 'repetition_penalty', label: 'Repetition penalty', min: 0.5, max: 2, step: 0.01, def: 1 },
    { key: 'max_tokens', label: 'Max tokens', min: 64, max: 32768, step: 64, def: 2048 },
  ]
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className="inline-flex h-8 items-center gap-1.5 rounded-sm px-2 text-[13px] text-text-secondary hover:bg-surface-3" aria-label="Sampling settings">
          <SlidersHorizontal className="size-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-3">
        <div className="mb-2 metadata-md text-text-secondary">Sampling</div>
        <div className="flex flex-col gap-2.5">
          {rows.map((r) => {
            const v = (sampler[r.key] as number | undefined) ?? r.def
            return (
              <label key={r.key} className="flex items-center gap-3 text-sm">
                <span className="w-32 shrink-0 text-text-secondary">{r.label}</span>
                <input type="range" min={r.min} max={r.max} step={r.step} value={v} onChange={(e) => onChange({ ...sampler, [r.key]: Number(e.target.value) })} className="flex-1 accent-[var(--accent)]" />
                <input
                  type="number"
                  min={r.min}
                  max={r.max}
                  step={r.step}
                  value={v}
                  onChange={(e) => onChange({ ...sampler, [r.key]: Number(e.target.value) })}
                  className="h-7 w-20 rounded-sm bg-surface-2 px-2 text-right tabular-nums hairline outline-none focus:border-[var(--accent)]"
                />
              </label>
            )
          })}
        </div>
        <div className="mt-2 text-[11px] text-text-disabled">Applies to this conversation. Seed and penalties can be set in Settings → Defaults.</div>
      </PopoverContent>
    </Popover>
  )
}
