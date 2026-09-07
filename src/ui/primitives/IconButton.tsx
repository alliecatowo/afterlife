import { forwardRef } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import type { ButtonSize, ButtonVariant } from './Button';

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Required: IconButtons carry no visible text, so this is the a11y name. */
  label: string;
  icon: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  pressed?: boolean;
  /** Small dot/status glyph rendered in the corner, e.g. an unread badge. */
  indicator?: ReactNode;
}

const base =
  'relative inline-flex items-center justify-center rounded-sm transition-colors shrink-0 ' +
  'duration-[var(--duration-instant)] ease-[var(--ease-standard)] focus-visible:focus-ring outline-none select-none ' +
  // Touch targets stay >=44px on narrow viewports even though the visible
  // control remains compact, per DESIGN's slim-perimeter rule.
  'max-[480px]:min-h-11 max-[480px]:min-w-11 ' +
  'disabled:cursor-not-allowed disabled:text-ink-500';

const variants: Record<ButtonVariant, string> = {
  solid: 'bg-ivory-100 text-ink-900 hover:bg-ivory-200 active:bg-ivory-300 disabled:bg-ink-700',
  ghost:
    'bg-transparent text-ivory-200 border border-line hover:bg-ink-700 hover:text-ivory-100 ' +
    'active:bg-ink-600 disabled:bg-transparent',
  quiet:
    'bg-transparent text-ivory-300 border border-transparent hover:bg-ink-800 hover:text-ivory-100 ' +
    'active:bg-ink-700 disabled:bg-transparent',
};

const sizes: Record<ButtonSize, string> = { sm: 'h-7 w-7', md: 'h-9 w-9' };

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, icon, variant = 'quiet', size = 'sm', pressed, indicator, className = '', ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      data-state={pressed ? 'on' : 'off'}
      className={[base, variants[variant], sizes[size], pressed ? 'border-line-strong' : '', className].join(' ')}
      {...props}
    >
      {icon}
      {indicator ? <span className="absolute -right-0.5 -top-0.5">{indicator}</span> : null}
    </button>
  );
});
