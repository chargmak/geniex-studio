import { create } from 'zustand'

export interface Artifact {
  id: string
  kind: 'html' | 'svg' | 'markdown' | 'code'
  title: string
  code: string
  lang?: string
}

interface ArtifactState {
  open: boolean
  current: Artifact | null
  show(a: Artifact): void
  close(): void
}

/** Right-hand artifact panel: live preview of HTML/SVG code blocks from replies (sandboxed iframe). */
export const useArtifactStore = create<ArtifactState>()((set) => ({
  open: false,
  current: null,
  show: (a) => set({ open: true, current: a }),
  close: () => set({ open: false }),
}))
