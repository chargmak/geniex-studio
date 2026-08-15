import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

/** Restrained empty/placeholder state (first-run, no results, offline). */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon?: LucideIcon
  title: string
  description?: string
  action?: React.ReactNode
  className?: string
}): React.JSX.Element {
  return (
    <div className={cn('flex h-full w-full flex-col items-center justify-center gap-3 p-8 text-center', className)}>
      {Icon && (
        <div className="flex size-11 items-center justify-center rounded-md bg-surface-3 hairline-subtle">
          <Icon className="size-5 text-text-secondary" strokeWidth={1.6} />
        </div>
      )}
      <div className="max-w-md">
        <h2 className="heading-xs text-text-primary">{title}</h2>
        {description && <p className="mt-1 body-sm text-text-secondary">{description}</p>}
      </div>
      {action && <div className="mt-1 flex items-center gap-2">{action}</div>}
    </div>
  )
}
