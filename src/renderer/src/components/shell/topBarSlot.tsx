import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

/**
 * Lets a page inject controls (model picker, run status…) into the shared TopBar without prop drilling.
 * Usage inside a page: `useTopBarSlot(<ModelPicker />)`.
 */
type Setter = (node: ReactNode | null) => void
const SlotCtx = createContext<{ node: ReactNode | null; set: Setter } | null>(null)

export function TopBarSlotProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [node, set] = useState<ReactNode | null>(null)
  return <SlotCtx.Provider value={{ node, set }}>{children}</SlotCtx.Provider>
}

export function TopBarSlotOutlet(): React.JSX.Element | null {
  const ctx = useContext(SlotCtx)
  return <>{ctx?.node ?? null}</>
}

export function useTopBarSlot(node: ReactNode | null): void {
  const ctx = useContext(SlotCtx)
  useEffect(() => {
    ctx?.set(node)
    return () => ctx?.set(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node])
}
