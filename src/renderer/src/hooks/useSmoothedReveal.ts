import { useEffect, useRef, useState } from 'react'

const CATCH_UP_MS = 180
const FLOOR_CPS = 45

function lastWordBoundary(source: string, cut: number): number {
  if (cut >= source.length) return source.length
  const i = source.lastIndexOf(' ', cut)
  return i === -1 ? 0 : i
}

/**
 * Eases the visible prefix of a streaming `target` string toward its full length (pattern from React Bits ai-chat-1):
 * exponential catch-up + a floor speed, cut at word boundaries while streaming. When `done` is true the full text is
 * shown immediately. Honors prefers-reduced-motion.
 */
export function useSmoothedReveal(target: string, done: boolean): string {
  const [text, setText] = useState(done ? target : '')
  const shownRef = useRef(done ? target.length : 0)
  const targetRef = useRef(target)
  const doneRef = useRef(done)
  targetRef.current = target
  doneRef.current = done
  const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

  useEffect(() => {
    if (done) {
      shownRef.current = target.length
      setText(target)
      return
    }
    let raf = 0
    let last = performance.now()
    const tick = (now: number): void => {
      const dt = Math.min(now - last, 64)
      last = now
      const t = targetRef.current
      const behind = t.length - shownRef.current
      if (behind > 0) {
        shownRef.current = reduce ? t.length : Math.min(t.length, shownRef.current + behind * (1 - Math.exp(-dt / CATCH_UP_MS)) + (FLOOR_CPS * dt) / 1000)
        const cut = Math.floor(shownRef.current)
        const finished = doneRef.current && cut >= t.length
        setText(t.slice(0, finished ? t.length : lastWordBoundary(t, cut)))
      } else if (behind < 0) {
        // target got shorter (reset)
        shownRef.current = t.length
        setText(t)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [done, reduce, target])

  return done ? target : text
}
