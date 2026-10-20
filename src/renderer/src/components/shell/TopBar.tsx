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
 * Right padding that keeps the bar's controls clear of the OS window controls when Electron draws them as an
 * overlay (titleBarStyle: 'hidden' + titleBarOverlay). Chromium exposes the overlay geometry through the Window
 * Controls Overlay environment variables, so the width is exact at every DPI and caption-button style instead of
 * a guessed constant. The bar's right edge is the window's right edge and the controls sit at the far right, so
 * the covered width is `100vw − titlebar-area-x − titlebar-area-width`. Outside Electron the variables are
 * undefined and the fallbacks reduce this to the normal 16px.
 */
const WINDOW_CONTROLS_CLEARANCE = 'calc(100vw - env(titlebar-area-x, 0px) - env(titlebar-area-width, 100vw) + 16px)'

/**
 * 40px top bar. In Electron the window's native title bar is hidden (titleBarStyle: 'hidden' + overlay), so this bar is
 * the drag surface and leaves room on the right for the OS window controls (see WINDOW_CONTROLS_CLEARANCE).
 */
export function TopBar({ children }: { children?: React.ReactNode }): React.JSX.Element {
  const { pathname } = useLocation()
  const theme = useUiStore((s) => s.theme)
  const toggleTheme = useUiStore((s) => s.toggleTheme)
  const isElectron = typeof window !== 'undefined' && !!window.studio?.isElectron
  const section = pathname.split('/')[1] ?? 'chat'

  return (
    <header
      className={cn('app-drag flex h-10 shrink-0 items-center gap-3 bg-surface-1 px-4 hairline-b')}
      style={isElectron ? { paddingRight: WINDOW_CONTROLS_CLEARANCE } : undefined}
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
