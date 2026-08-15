import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

/** DS §2.2 Badge/tag: 20px tall, 4px radius, 0 4px padding, 12px weight 500, dark-tinted fill + light-tinted text. */
const badgeVariants = cva(
  'inline-flex h-5 shrink-0 items-center gap-1 rounded-sm px-1 text-xs font-medium leading-4 whitespace-nowrap [&>svg]:size-3',
  {
    variants: {
      variant: {
        info: 'bg-[var(--gx-badge-bg)] text-[var(--gx-badge-fg)]',
        neutral: 'bg-[color-mix(in_srgb,var(--fg-primary)_10%,transparent)] text-text-primary',
        overline: 'bg-[color-mix(in_srgb,var(--fg-primary)_8%,transparent)] text-[var(--gx-badge-fg)]',
        highlight: 'bg-highlight text-[#0a0a0a]',
        outline: 'hairline text-text-secondary bg-transparent',
        positive: 'bg-positive-soft text-positive',
        negative: 'bg-negative-soft text-negative',
        warning: 'bg-warning-soft text-warning',
        accent: 'bg-accent-soft text-accent-brand',
        community: 'bg-[color-mix(in_srgb,var(--gx-gold)_18%,transparent)] text-community',
        npu: 'bg-[color-mix(in_srgb,var(--q-teal-400)_18%,transparent)] text-teal-300',
        pending: 'bg-[color-mix(in_srgb,var(--q-semantic-pending)_18%,transparent)] text-job-pending',
        running: 'bg-[color-mix(in_srgb,var(--q-semantic-running)_18%,transparent)] text-job-running',
        initializing: 'bg-[color-mix(in_srgb,var(--q-semantic-initializing)_18%,transparent)] text-job-initializing',
      },
    },
    defaultVariants: { variant: 'neutral' },
  },
)

export interface BadgeProps extends React.ComponentProps<'span'>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps): React.JSX.Element {
  return <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }
