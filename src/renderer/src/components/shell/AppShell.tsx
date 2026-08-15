import { Outlet } from 'react-router'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'
import { TopBarSlotProvider, TopBarSlotOutlet } from './topBarSlot'

/** Root frame: sidebar · (top bar + routed content). Height-bounded so nested App-UI blocks can scroll internally. */
export function AppShell(): React.JSX.Element {
  return (
    <TooltipProvider>
      <TopBarSlotProvider>
        <div className="flex h-dvh w-full overflow-hidden bg-surface-1 text-text-primary">
          <Sidebar />
          <div className="flex min-w-0 flex-1 flex-col">
            <TopBar>
              <TopBarSlotOutlet />
            </TopBar>
            <main className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
              <Outlet />
            </main>
          </div>
        </div>
      </TopBarSlotProvider>
    </TooltipProvider>
  )
}
