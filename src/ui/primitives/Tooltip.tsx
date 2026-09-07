import * as RadixTooltip from '@radix-ui/react-tooltip';
import type { ReactNode } from 'react';

export interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  side?: 'top' | 'right' | 'bottom' | 'left';
  delayDuration?: number;
}

export function Tooltip({ content, children, side = 'top', delayDuration = 400 }: TooltipProps) {
  return (
    <RadixTooltip.Root delayDuration={delayDuration}>
      <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content
          side={side}
          sideOffset={6}
          className={
            'z-[var(--z-toast)] max-w-56 rounded-sm border border-line bg-surface-raised px-2 py-1 text-xs ' +
            'text-ivory-200 shadow-[var(--shadow-raise)] ' +
            'data-[state=delayed-open]:animate-[tooltip-in_var(--duration-fast)_var(--ease-entrance)] ' +
            'data-[state=closed]:animate-[tooltip-out_var(--duration-fast)_var(--ease-exit)]'
          }
        >
          {content}
          <RadixTooltip.Arrow className="fill-surface-raised" />
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  );
}

/** Mount once near the app root. */
export const TooltipProvider = RadixTooltip.Provider;
