import { useLocation } from 'react-router'
import { Moon, Search, Sun } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useUiStore } from '@/stores/uiStore'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { UpdatePill } from './UpdatePill'

const TITLES: Record<string, string> = {
  chat: 'Chat',
  agents: 'Agents',
  studio: 'Studio',
  knowledge: 'Knowledge',
  models: 'Models',
  system: 'System',
  settings: 'Settings',
}

/**
 * 40px top bar. In Electron the window's native title bar is hidden (titleBarStyle: 'hidden' + overlay), so this bar is
 * the drag surface and leaves room on the right for the OS window controls (overlay width ≈ 138px on Windows).
 */
export function TopBar({ children }: { children?: React.ReactNode }): React.JSX.Element {
  const { pathname } = useLocation()
  const theme = useUiStore((s) => s.theme)
  const toggleTheme = useUiStore((s) => s.toggleTheme)
  const isElectron = typeof window !== 'undefined' && !!window.studio?.isElectron
  const section = pathname.split('/')[1] ?? 'chat'

  return (
    <header
      className={cn(
        'app-drag flex h-10 shrink-0 items-center gap-3 bg-surface-1 px-4 hairline-b',
        isElectron && 'pr-[148px]',
      )}
    >
      <h1 className="text-sm font-[560] tracking-[0.01em] text-text-primary">{TITLES[section] ?? 'GenieX Studio'}</h1>
      <div className="app-no-drag flex min-w-0 flex-1 items-center gap-2">{children}</div>
      <div className="app-no-drag flex items-center gap-1">
        <UpdatePill />
        <button type="button" onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }))} className="flex h-8 items-center gap-2 rounded-sm px-2 text-xs text-text-secondary hover:bg-surface-3 hover:text-text-primary" aria-label="Open command palette">
          <Search className="size-3.5" />
          <span className="hidden md:inline">Commands</span>
          <kbd className="rounded-xs bg-surface-3 px-1 metadata-sm">Ctrl K</kbd>
        </button>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="iconSm" onClick={toggleTheme} aria-label="Toggle theme">
              {theme === 'dark' ? <Sun /> : <Moon />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>Switch to {theme === 'dark' ? 'light' : 'dark'} theme</TooltipContent>
        </Tooltip>
      </div>
    </header>
  )
}
