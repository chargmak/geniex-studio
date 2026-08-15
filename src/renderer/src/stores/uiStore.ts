import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type Theme = 'dark' | 'light'

interface UiState {
  theme: Theme
  sidebarCollapsed: boolean
  rightPanelOpen: boolean
  setTheme(theme: Theme): void
  toggleTheme(): void
  toggleSidebar(): void
  setRightPanelOpen(open: boolean): void
}

function applyTheme(theme: Theme): void {
  if (typeof document !== 'undefined') document.documentElement.dataset.theme = theme
}

export const useUiStore = create<UiState>()(
  persist(
    (set, get) => ({
      theme: 'dark',
      sidebarCollapsed: false,
      rightPanelOpen: false,
      setTheme: (theme) => {
        applyTheme(theme)
        set({ theme })
      },
      toggleTheme: () => get().setTheme(get().theme === 'dark' ? 'light' : 'dark'),
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setRightPanelOpen: (open) => set({ rightPanelOpen: open }),
    }),
    {
      name: 'geniex-studio.ui',
      onRehydrateStorage: () => (state) => {
        if (state) applyTheme(state.theme)
      },
    },
  ),
)
