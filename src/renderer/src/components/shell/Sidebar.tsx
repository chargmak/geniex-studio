import { NavLink } from 'react-router'
import { Bot, Boxes, Cpu, ImageIcon, MessageSquare, PanelLeftClose, PanelLeftOpen, Settings, BookOpen } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useUiStore } from '@/stores/uiStore'
import { BrandMark } from './BrandMark'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ServerStatusPill } from './ServerStatusPill'

const NAV = [
  { to: '/chat', label: 'Chat', icon: MessageSquare, hint: 'Conversations with local models' },
  { to: '/agents', label: 'Agents', icon: Bot, hint: 'Agent runs, tools and approvals' },
  { to: '/studio', label: 'Studio', icon: ImageIcon, hint: 'Image generation, voice and embeddings on the NPU (sidecar)' },
  { to: '/knowledge', label: 'Knowledge', icon: BookOpen, hint: 'Index local folders and answer with cited excerpts (RAG on the NPU)' },
  { to: '/models', label: 'Models', icon: Boxes, hint: 'Installed models and the AI Hub catalogue' },
  { to: '/system', label: 'System', icon: Cpu, hint: 'GenieX server, NPU and telemetry' },
  { to: '/settings', label: 'Settings', icon: Settings, hint: 'Sampling, compute, MCP, workspace' },
] as const

export function Sidebar(): React.JSX.Element {
  const collapsed = useUiStore((s) => s.sidebarCollapsed)
  const toggleSidebar = useUiStore((s) => s.toggleSidebar)

  return (
    <aside
      data-collapsed={collapsed || undefined}
      className={cn(
        'flex h-full shrink-0 flex-col bg-surface-2 hairline-r transition-[width] duration-(--q-transition-duration-normal) ease-(--q-ease-in-out)',
        collapsed ? 'w-14' : 'w-60',
      )}
    >
      {/* Brand row doubles as window-drag surface in Electron */}
      <div className={cn('app-drag flex h-10 items-center gap-2 px-3', collapsed && 'justify-center px-0')}>
        <BrandMark />
        {!collapsed && (
          <div className="flex min-w-0 items-baseline gap-1.5">
            <span className="truncate text-sm font-[660] tracking-[0.01em] text-text-primary">GenieX</span>
            <span className="text-sm font-[400] text-text-secondary">Studio</span>
          </div>
        )}
      </div>

      <nav className="mt-2 flex flex-1 flex-col gap-0.5 px-2" aria-label="Primary">
        {NAV.map(({ to, label, icon: Icon, hint }) => {
          const link = (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                cn(
                  'group relative flex h-8 items-center gap-2.5 rounded-sm px-2 text-sm font-medium leading-5 text-text-secondary',
                  'transition-[background-color,color] duration-(--q-transition-duration-fast) ease-(--q-ease-in-out)',
                  'hover:bg-surface-3 hover:text-text-primary',
                  isActive && 'bg-accent-soft text-accent-brand hover:bg-accent-soft hover:text-accent-brand',
                  collapsed && 'justify-center px-0',
                )
              }
            >
              {({ isActive }) => (
                <>
                  {isActive && <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-accent-brand" aria-hidden />}
                  <Icon className="size-4 shrink-0" strokeWidth={1.75} />
                  {!collapsed && <span className="truncate">{label}</span>}
                </>
              )}
            </NavLink>
          )
          return collapsed ? (
            <Tooltip key={to}>
              <TooltipTrigger asChild>{link}</TooltipTrigger>
              <TooltipContent side="right">
                <span className="font-medium">{label}</span>
                <span className="block text-text-secondary">{hint}</span>
              </TooltipContent>
            </Tooltip>
          ) : (
            link
          )
        })}
      </nav>

      <div className={cn('flex flex-col gap-2 p-2', collapsed && 'items-center')}>
        <ServerStatusPill compact={collapsed} />
        <button
          type="button"
          onClick={toggleSidebar}
          className={cn(
            'flex h-8 items-center gap-2 rounded-sm px-2 text-xs text-text-secondary hover:bg-surface-3 hover:text-text-primary',
            collapsed && 'w-8 justify-center px-0',
          )}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
          {!collapsed && <span>Collapse</span>}
        </button>
      </div>
    </aside>
  )
}
