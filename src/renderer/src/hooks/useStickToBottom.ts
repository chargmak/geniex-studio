import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'

/** Keeps a scroll container pinned to the bottom while content grows, unless the user scrolls up (React Bits pattern). */
export function useStickToBottom(scrollRef: RefObject<HTMLDivElement | null>, deps: unknown[] = []): { showJump: boolean; jumpToLatest: () => void } {
  const stickRef = useRef(true)
  const [showJump, setShowJump] = useState(false)

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const sync = (): void => {
      const overflowing = el.scrollHeight - el.clientHeight > 1
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight
      const atBottom = !overflowing || distance < 24
      stickRef.current = atBottom
      setShowJump(overflowing && !atBottom)
    }
    const onIntent = (e: WheelEvent | TouchEvent): void => {
      const up = 'deltaY' in e ? e.deltaY < 0 : true
      if (!up) return
      if (el.scrollHeight - el.clientHeight > 1 && el.scrollTop > 0) stickRef.current = false
    }
    const observer = new ResizeObserver(() => {
      if (stickRef.current) el.scrollTop = el.scrollHeight
      sync()
    })
    observer.observe(el)
    if (el.firstElementChild) observer.observe(el.firstElementChild)
    el.addEventListener('wheel', onIntent, { passive: true })
    el.addEventListener('touchmove', onIntent, { passive: true })
    el.addEventListener('scroll', sync, { passive: true })
    el.scrollTop = el.scrollHeight
    sync()
    return () => {
      observer.disconnect()
      el.removeEventListener('wheel', onIntent)
      el.removeEventListener('touchmove', onIntent)
      el.removeEventListener('scroll', sync)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  const jumpToLatest = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    stickRef.current = true
    setShowJump(false)
    el.scrollTop = el.scrollHeight
  }, [scrollRef])

  return { showJump, jumpToLatest }
}
