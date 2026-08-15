import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { Bot, Boxes, Cpu, MessageSquare, Moon, Play, RefreshCw, Search, Settings, Square, Sun } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useUiStore } from '@/stores/uiStore'
import { useServerStore } from '@/stores/serverStore'
import { useChatStore } from '@/stores/chatStore'
import { useModelsStore } from '@/stores/modelsStore'

interface Command {
  id: string
  label: string
  hint?: string
  icon: React.ComponentType<{ className?: string }>
  keywords?: string
  run: () => void | Promise<void>
}

/** Ctrl+K palette: navigation, server control, theme, model switch (React Bits command-menu pattern). */
export function CommandPalette(): React.JSX.Element | null {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [index, setIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()
  const theme = useUiStore((s) => s.theme)
  const toggleTheme = useUiStore((s) => s.toggleTheme)
  const genie = useServerStore((s) => s.genie)
  const start = useServerStore((s) => s.start)
  const stop = useServerStore((s) => s.stop)
  const restart = useServerStore((s) => s.restart)
  const createConversation = useChatStore((s) => s.createConversation)
  const activeId = useChatStore((s) => s.activeId)
  const updateConversation = useChatStore((s) => s.updateConversation)
  const installed = useModelsStore((s) => s.installed)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((o) => !o)
      }
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  useEffect(() => {
    if (open) {
      setQ('')
      setIndex(0)
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }, [open])

  const commands = useMemo<Command[]>(() => {
    const base: Command[] = [
      { id: 'new-chat', label: 'New chat', icon: MessageSquare, keywords: 'conversation', run: async () => navigate(`/chat/${(await createConversation()).id}`) },
      { id: 'new-agent', label: 'New agent task', icon: Bot, keywords: 'tools run', run: async () => navigate(`/chat/${(await createConversation({ mode: 'agent' })).id}`) },
      { id: 'go-chat', label: 'Go to Chat', icon: MessageSquare, run: () => navigate('/chat') },
      { id: 'go-agents', label: 'Go to Agents', icon: Bot, run: () => navigate('/agents') },
      { id: 'go-models', label: 'Go to Models', icon: Boxes, run: () => navigate('/models') },
      { id: 'go-system', label: 'Go to System', icon: Cpu, run: () => navigate('/system') },
      { id: 'go-settings', label: 'Go to Settings', icon: Settings, run: () => navigate('/settings') },
      { id: 'theme', label: `Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`, icon: theme === 'dark' ? Sun : Moon, run: toggleTheme },
    ]
    if (genie?.state === 'running') {
      base.push({ id: 'srv-restart', label: 'Restart GenieX server', icon: RefreshCw, run: restart })
      base.push({ id: 'srv-stop', label: 'Stop GenieX server', icon: Square, run: stop })
    } else base.push({ id: 'srv-start', label: 'Start GenieX server', icon: Play, run: start })
    for (const m of installed)
      for (const id of m.requestIds)
        base.push({
          id: `model-${id}`,
          label: `Use model ${id}`,
          hint: activeId ? 'for this chat' : 'for the next chat',
          icon: Cpu,
          keywords: 'switch model',
          run: async () => {
            if (activeId) await updateConversation(activeId, { model: id })
            else navigate('/chat')
          },
        })
    return base
  }, [activeId, createConversation, genie?.state, installed, navigate, restart, start, stop, theme, toggleTheme, updateConversation])

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return commands
    return commands.filter((c) => `${c.label} ${c.keywords ?? ''}`.toLowerCase().includes(needle))
  }, [commands, q])
  useEffect(() => setIndex(0), [q])

  if (!open) return null
  const run = async (c: Command): Promise<void> => {
    setOpen(false)
    await c.run()
  }

  return (
    <div className="fixed inset-0 z-(--z-modal) flex items-start justify-center bg-[color-mix(in_srgb,var(--surface-1)_55%,transparent)] pt-[14vh]" onMouseDown={() => setOpen(false)}>
      <div className="w-[560px] max-w-[92vw] overflow-hidden rounded-lg bg-surface-3 shadow-4 hairline" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex h-11 items-center gap-2 px-3 hairline-b">
          <Search className="size-4 text-text-secondary" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setIndex((i) => Math.min(filtered.length - 1, i + 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setIndex((i) => Math.max(0, i - 1))
              } else if (e.key === 'Enter' && filtered[index]) void run(filtered[index])
            }}
            placeholder="Type a command…"
            className="h-full flex-1 bg-transparent text-sm outline-none placeholder:text-text-disabled"
          />
          <kbd className="rounded-xs bg-surface-4 px-1.5 py-0.5 metadata-sm text-text-secondary">Esc</kbd>
        </div>
        <div className="max-h-[50vh] overflow-y-auto p-1">
          {!filtered.length && <div className="px-3 py-6 text-center text-sm text-text-secondary">No matching commands.</div>}
          {filtered.map((c, i) => (
            <button key={c.id} type="button" onMouseEnter={() => setIndex(i)} onClick={() => void run(c)} className={cn('flex w-full items-center gap-2.5 rounded-sm px-2.5 py-2 text-left text-sm', i === index ? 'bg-accent-soft text-text-primary' : 'text-text-secondary hover:bg-surface-4')}>
              <c.icon className="size-4 shrink-0" />
              <span className="min-w-0 flex-1 truncate">{c.label}</span>
              {c.hint && <span className="text-xs text-text-disabled">{c.hint}</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
