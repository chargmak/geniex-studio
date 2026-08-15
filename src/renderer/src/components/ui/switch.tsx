import * as React from 'react'
import { Switch as SwitchPrimitive } from 'radix-ui'
import { cn } from '@/lib/utils'

/** DS-styled toggle: 0.8px border, accent fill when on, quick easing. */
export function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>): React.JSX.Element {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        'peer inline-flex h-5 w-9 shrink-0 items-center rounded-full bg-surface-4 hairline transition-colors duration-(--q-transition-duration-fast) ease-(--q-ease-quick) outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-ring)] disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-accent-brand data-[state=checked]:border-transparent',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb data-slot="switch-thumb" className="pointer-events-none block size-4 translate-x-0.5 rounded-full bg-white shadow-1 transition-transform duration-(--q-transition-duration-fast) ease-(--q-ease-quick) data-[state=checked]:translate-x-[18px]" />
    </SwitchPrimitive.Root>
  )
}
