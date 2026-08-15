import { useMemo, useState } from 'react'
import { MoreHorizontal, Pin, PinOff, Plus, Search, Trash2, Pencil, Bot, MessageSquare } from 'lucide-react'
import type { Conversation } from '@shared/chat'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

function groupLabel(ts: number): string {
  const d = new Date(ts)
  const now = new Date()
  const startOfDay = (x: Date): number => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const diffDays = Math.round((startOfDay(now) - startOfDay(d)) / 86_400_000)
  if (diffDays <= 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 7) return 'Previous 7 days'
  if (diffDays < 30) return 'Previous 30 days'
  return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
}

export function ConversationList({
  conversations,
  activeId,
  streamingIds,
  onSelect,
  onNew,
  onRename,
  onDelete,
  onTogglePin,
}: {
  conversations: Conversation[]
  activeId: string | null
  streamingIds: Set<string>
  onSelect: (id: string) => void
  onNew: () => void
  onRename: (id: string, title: string) => void
  onDelete: (id: string) => void
  onTogglePin: (c: Conversation) => void
}): React.JSX.Element {
  const [q, setQ] = useState('')
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null)

  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const list = conversations.filter((c) => !needle || c.title.toLowerCase().includes(needle) || (c.lastMessagePreview ?? '').toLowerCase().includes(needle))
    const pinned = list.filter((c) => c.pinned)
    const rest = list.filter((c) => !c.pinned)
    const out: { label: string; items: Conversation[] }[] = []
    if (pinned.length) out.push({ label: 'Pinned', items: pinned })
    for (const c of rest) {
      const label = groupLabel(c.updatedAt)
      const g = out.find((x) => x.label === label)
      if (g) g.items.push(c)
      else out.push({ label, items: [c] })
    }
    return out
  }, [conversations, q])

  return (
    <aside className="flex h-full w-72 shrink-0 flex-col bg-surface-2 hairline-r">
      <div className="flex items-center gap-2 p-2">
        <div className="flex h-8 flex-1 items-center gap-2 rounded-sm bg-surface-1 px-2 hairline-subtle">
          <Search className="size-3.5 text-text-secondary" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search chats" className="h-full flex-1 bg-transparent text-[13px] outline-none placeholder:text-text-disabled" />
        </div>
        <Button variant="primary" size="iconSm" onClick={onNew} aria-label="New chat">
          <Plus />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {!conversations.length && <div className="px-2 py-8 text-center text-xs text-text-secondary">No conversations yet.</div>}
        {groups.map((g) => (
          <div key={g.label} className="mb-2">
            <div className="px-2 pt-2 pb-1 eyebrow-s text-text-disabled">{g.label}</div>
            {g.items.map((c) => {
              const active = c.id === activeId
              const isRenaming = renaming?.id === c.id
              return (
                <div
                  key={c.id}
                  className={cn('group/row relative flex h-9 items-center gap-2 rounded-sm px-2 text-[13px] hover:bg-surface-3', active && 'bg-accent-soft text-text-primary hover:bg-accent-soft')}
                >
                  {c.mode === 'agent' ? <Bot className="size-3.5 shrink-0 text-text-secondary" /> : <MessageSquare className="size-3.5 shrink-0 text-text-secondary" />}
                  {isRenaming ? (
                    <input
                      autoFocus
                      value={renaming.value}
                      onChange={(e) => setRenaming({ id: c.id, value: e.target.value })}
                      onBlur={() => {
                        if (renaming.value.trim()) onRename(c.id, renaming.value.trim())
                        setRenaming(null)
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                        if (e.key === 'Escape') setRenaming(null)
                      }}
                      className="h-6 flex-1 rounded-xs bg-surface-1 px-1 outline-none hairline"
                    />
                  ) : (
                    <button type="button" onClick={() => onSelect(c.id)} className="min-w-0 flex-1 truncate text-left" title={c.title}>
                      {c.title}
                    </button>
                  )}
                  {streamingIds.has(c.id) && <span className="job-dot bg-job-running animate-pulse" aria-label="Generating" />}
                  {c.pinned && !streamingIds.has(c.id) && <Pin className="size-3 text-text-disabled" />}
                  <Popover>
                    <PopoverTrigger asChild>
                      <button type="button" className="flex size-6 shrink-0 items-center justify-center rounded-sm text-text-secondary opacity-0 hover:bg-surface-4 hover:text-text-primary group-hover/row:opacity-100 data-[state=open]:opacity-100" aria-label="Conversation actions">
                        <MoreHorizontal className="size-3.5" />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent className="w-44 p-1" align="end">
                      <MenuItem icon={Pencil} label="Rename" onClick={() => setRenaming({ id: c.id, value: c.title })} />
                      <MenuItem icon={c.pinned ? PinOff : Pin} label={c.pinned ? 'Unpin' : 'Pin'} onClick={() => onTogglePin(c)} />
                      <MenuItem icon={Trash2} label="Delete" danger onClick={() => onDelete(c.id)} />
                    </PopoverContent>
                  </Popover>
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </aside>
  )
}

function MenuItem({ icon: Icon, label, onClick, danger }: { icon: React.ComponentType<{ className?: string }>; label: string; onClick: () => void; danger?: boolean }): React.JSX.Element {
  return (
    <button type="button" onClick={onClick} className={cn('flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-[13px] hover:bg-surface-4', danger ? 'text-negative' : 'text-text-primary')}>
      <Icon className="size-3.5" />
      {label}
    </button>
  )
}
