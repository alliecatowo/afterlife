import { forwardRef } from 'react';
import type { ButtonHTMLAttributes } from 'react';

export type ButtonVariant = 'solid' | 'ghost' | 'quiet';
export type ButtonSize = 'sm' | 'md';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Visually marks the button as the active/on state of a concept (not a colour fill). */
  pressed?: boolean;
}

const base =
  'inline-flex items-center justify-center gap-1.5 rounded-sm font-sans transition-colors ' +
  'duration-[var(--duration-instant)] ease-[var(--ease-standard)] focus-visible:focus-ring outline-none select-none ' +
  'disabled:cursor-not-allowed disabled:text-ink-500 disabled:opacity-100 ' +
  // Touch targets stay >=44px on narrow viewports even though the visible
  // control remains compact — same rule `IconButton`/`Toggle` already apply.
  'max-[480px]:min-h-11';

const variants: Record<ButtonVariant, string> = {
  solid:
    'bg-ivory-100 text-ink-900 border border-transparent hover:bg-ivory-200 active:bg-ivory-300 ' +
    'disabled:bg-ink-700 disabled:border-transparent',
  ghost:
    'bg-transparent text-ivory-200 border border-line hover:bg-ink-700 hover:text-ivory-100 ' +
    'active:bg-ink-600 disabled:border-line disabled:bg-transparent',
  quiet:
    'bg-transparent text-ivory-300 border border-transparent hover:bg-ink-800 hover:text-ivory-100 ' +
    'active:bg-ink-700 disabled:bg-transparent',
};

const sizes: Record<ButtonSize, string> = {
  sm: 'h-7 px-3 text-xs',
  md: 'h-9 px-4 text-sm',
};

/**
 * The base control. `pressed` paints the DESIGN.md "selected/on" treatment
 * (a strong hairline + accent underline supplied by the caller via
 * `data-accent`) — colour alone never carries the state.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'ghost', size = 'sm', pressed, className = '', ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      aria-pressed={pressed}
      data-state={pressed ? 'on' : 'off'}
      className={[
        base,
        variants[variant],
        sizes[size],
        pressed ? 'border-line-strong' : '',
        className,
      ].join(' ')}
      {...props}
    />
  );
});
