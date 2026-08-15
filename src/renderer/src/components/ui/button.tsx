import * as React from 'react'
import { Slot } from 'radix-ui'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

/**
 * DS §2.1 Button: 40px tall, 4px radius, 14px/20 weight 500, .161s transition.
 * primary = solid brand fill · secondary = transparent w/ 0.8px border · ghost = text-only · link = underline on hover.
 */
const buttonVariants = cva(
  [
    'inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap select-none',
    'rounded-sm text-sm font-medium leading-5',
    'transition-[background-color,border-color,color,box-shadow,opacity] duration-(--q-transition-duration-fast) ease-(--q-ease-in-out)',
    'disabled:pointer-events-none disabled:opacity-40',
    'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent-ring)]',
    "[&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 [&_svg]:shrink-0",
  ],
  {
    variants: {
      variant: {
        primary: 'bg-accent-brand text-accent-fg hover:bg-accent-strong active:brightness-95',
        secondary:
          'bg-transparent text-text-primary hairline hover:bg-surface-3 hover:border-[var(--border-strong)] active:bg-surface-4',
        ghost: 'bg-transparent text-text-secondary hover:bg-surface-3 hover:text-text-primary active:bg-surface-4',
        subtle: 'bg-surface-3 text-text-primary hover:bg-surface-4',
        destructive: 'bg-negative text-white hover:brightness-110',
        link: 'h-auto rounded-none px-0 text-text-secondary underline-offset-4 hover:text-text-primary hover:underline',
        accentSoft: 'bg-accent-soft text-accent-brand hover:bg-[color-mix(in_srgb,var(--accent)_24%,transparent)]',
      },
      size: {
        default: 'h-10 px-5',
        sm: 'h-8 px-3 text-[13px]',
        xs: 'h-7 px-2.5 text-xs',
        lg: 'h-11 px-6',
        icon: 'size-10',
        iconSm: 'size-8',
        iconXs: 'size-7',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'default',
    },
  },
)

export interface ButtonProps extends React.ComponentProps<'button'>, VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

function Button({ className, variant, size, asChild = false, type, ...props }: ButtonProps): React.JSX.Element {
  const Comp = asChild ? Slot.Root : 'button'
  return (
    <Comp
      data-slot="button"
      type={asChild ? undefined : (type ?? 'button')}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
