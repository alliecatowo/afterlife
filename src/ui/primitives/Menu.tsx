import * as RadixDropdown from '@radix-ui/react-dropdown-menu';
import type { ReactNode } from 'react';

export interface MenuOption<V extends string> {
  value: V;
  label: string;
  /** A token `var(...)` string or CSS gradient, rendered as a small swatch chip. */
  swatch?: string;
  /** Short "what this means" caption, shown inline under the label — the
   *  menu IS the reachable-by-keyboard-and-touch legend, not a hover aside. */
  description?: string;
}

export interface MenuProps<V extends string> {
  /** Rendered as the trigger via `asChild` — typically a `Button`/`IconButton`. */
  trigger: ReactNode;
  /** Accessible name for the popover's own `menu` role, independent of the trigger's label. */
  'aria-label': string;
  options: MenuOption<V>[];
  value: V;
  onChange: (value: V) => void;
  align?: 'start' | 'center' | 'end';
}

/**
 * A compact trigger + popover list, per DESIGN.md's "controls hold a slim
 * perimeter" rule: the trigger occupies one control's worth of HUD width no
 * matter how many `options` exist, and the full list opens in a Radix
 * `DropdownMenu` — genuinely keyboard-operable (arrow keys, `Home`/`End`,
 * type-ahead) and touch-tappable, never a hover-only affordance. Built for
 * the render-lens picker (`Hud.tsx`) but generic — any HUD control that
 * outgrows a `Toggle` group's available width belongs here.
 */
export function Menu<V extends string>({
  trigger,
  'aria-label': ariaLabel,
  options,
  value,
  onChange,
  align = 'start',
}: MenuProps<V>) {
  return (
    <RadixDropdown.Root>
      <RadixDropdown.Trigger asChild>{trigger}</RadixDropdown.Trigger>
      <RadixDropdown.Portal>
        <RadixDropdown.Content
          align={align}
          sideOffset={6}
          aria-label={ariaLabel}
          className={
            'z-[var(--z-overlay)] min-w-64 rounded-sm border border-line bg-surface-raised p-1 ' +
            'shadow-[var(--shadow-float)] focus:outline-none ' +
            'data-[state=open]:animate-[overlay-in_var(--duration-fast)_var(--ease-entrance)] ' +
            'data-[state=closed]:animate-[overlay-out_var(--duration-fast)_var(--ease-exit)]'
          }
        >
          <RadixDropdown.RadioGroup value={value} onValueChange={(v) => onChange(v as V)}>
            {options.map((opt) => (
              <RadixDropdown.RadioItem
                key={opt.value}
                value={opt.value}
                className={
                  'flex cursor-pointer items-start gap-2.5 rounded-sm px-2.5 py-1.5 text-sm text-ivory-200 ' +
                  'outline-none transition-colors duration-[var(--duration-instant)] ' +
                  'data-[highlighted]:bg-ink-700 data-[highlighted]:text-ivory-100 ' +
                  'data-[state=checked]:text-ivory-100 max-[480px]:min-h-11'
                }
              >
                {opt.swatch ? (
                  <span
                    aria-hidden="true"
                    className="mt-1 h-2.5 w-2.5 shrink-0 rounded-xs border border-line-strong"
                    style={{ background: opt.swatch }}
                  />
                ) : null}
                <span className="flex flex-1 flex-col">
                  <span className="flex items-center gap-1.5">
                    {opt.label}
                    <RadixDropdown.ItemIndicator className="text-micro uppercase tracking-[0.14em] text-ivory-300">
                      current
                    </RadixDropdown.ItemIndicator>
                  </span>
                  {opt.description ? (
                    <span className="text-xs text-ivory-300">{opt.description}</span>
                  ) : null}
                </span>
              </RadixDropdown.RadioItem>
            ))}
          </RadixDropdown.RadioGroup>
        </RadixDropdown.Content>
      </RadixDropdown.Portal>
    </RadixDropdown.Root>
  );
}
