import { cn } from '@/lib/utils'

/** GenieX Studio mark: a hexagon (Hexagon NPU) with an inset spark. Pure SVG so it stays crisp at any DPI. */
export function BrandMark({ className, size = 22 }: { className?: string; size?: number }): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn('shrink-0', className)}
      aria-hidden
    >
      <path
        d="M12 2.2 20.5 7v10L12 21.8 3.5 17V7L12 2.2Z"
        stroke="var(--accent)"
        strokeWidth="1.6"
        strokeLinejoin="round"
        fill="color-mix(in srgb, var(--accent) 14%, transparent)"
      />
      <path d="M12 7.2v9.6M7.8 9.6l8.4 4.8M7.8 14.4l8.4-4.8" stroke="var(--accent-strong)" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}
