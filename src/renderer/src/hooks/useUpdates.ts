import { useCallback, useEffect, useState } from 'react'
import type { UpdateState } from '@shared/update'

/**
 * Live auto-update state from the Electron shell. Returns null in browser/headless mode, where there is no
 * installer to update — callers should render nothing in that case.
 */
export function useUpdates(): {
  state: UpdateState | null
  check: () => Promise<void>
  download: () => Promise<void>
  install: () => Promise<void>
} {
  const [state, setState] = useState<UpdateState | null>(null)

  useEffect(() => {
    const updates = window.studio?.updates
    if (!updates) return
    let alive = true
    void updates.get().then((s) => {
      if (alive) setState(s)
    })
    const off = updates.onChange((s) => setState(s))
    return () => {
      alive = false
      off()
    }
  }, [])

  const check = useCallback(async () => {
    const s = await window.studio?.updates.check()
    if (s) setState(s)
  }, [])
  const download = useCallback(async () => {
    const s = await window.studio?.updates.download()
    if (s) setState(s)
  }, [])
  const install = useCallback(async () => {
    await window.studio?.updates.install()
  }, [])

  return { state, check, download, install }
}
