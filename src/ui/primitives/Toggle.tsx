import * as RadixToggleGroup from '@radix-ui/react-toggle-group';
import type { ReactNode } from 'react';

export interface ToggleOption<V extends string> {
  value: V;
  label: string;
  icon?: ReactNode;
  /** Rendered as a 2px inline marker on the selected item — the concept's own accent, never a fill. */
  accent?: string;
  disabled?: boolean;
}

interface SharedProps<V extends string> {
  options: ToggleOption<V>[];
  size?: 'sm' | 'md';
  'aria-label': string;
  className?: string;
}

export interface ToggleSingleProps<V extends string> extends SharedProps<V> {
  type?: 'single';
  value: V;
  onChange: (value: V) => void;
}

export interface ToggleMultipleProps<V extends string> extends SharedProps<V> {
  type: 'multiple';
  value: V[];
  onChange: (value: V[]) => void;
}

const itemBase =
  'inline-flex items-center gap-1.5 whitespace-nowrap rounded-sm border border-transparent px-2.5 h-7 text-xs ' +
  'text-ivory-300 transition-colors duration-[var(--duration-instant)] ease-[var(--ease-standard)] focus-visible:focus-ring outline-none ' +
  'hover:bg-ink-700 hover:text-ivory-100 data-[state=on]:text-ivory-100 data-[state=on]:border-line-strong ' +
  'data-[state=on]:bg-ink-700 disabled:cursor-not-allowed disabled:text-ink-500 disabled:hover:bg-transparent ' +
  'max-[480px]:h-11';

/**
 * A single vocabulary component covering both Radix ToggleGroup modes
 * (`type="single" | "multiple"`), per DESIGN.md's `Toggle (ToggleGroup)`.
 * Selected items get a hairline + a 2px accent underline in their own
 * concept's colour — never a colour fill alone.
 */
export function Toggle<V extends string>(props: ToggleSingleProps<V> | ToggleMultipleProps<V>) {
  const { options, className = '', ...rest } = props;
  const common = {
    className: `inline-flex gap-1 rounded-sm border border-line bg-ink-800 p-0.5 ${className}`,
    'aria-label': rest['aria-label'],
  };

  const items = options.map((opt) => (
    <RadixToggleGroup.Item key={opt.value} value={opt.value} disabled={opt.disabled} className={itemBase}>
      {opt.icon}
      <span>{opt.label}</span>
      {opt.accent ? (
        <span
          aria-hidden="true"
          className="ml-0.5 hidden h-0.5 w-3 rounded-full group-data-[state=on]:block"
          style={{ background: opt.accent }}
        />
      ) : null}
    </RadixToggleGroup.Item>
  ));

  if (rest.type === 'multiple') {
    return (
      <RadixToggleGroup.Root type="multiple" value={rest.value} onValueChange={rest.onChange} {...common}>
        {items}
      </RadixToggleGroup.Root>
    );
  }
  const single = rest as ToggleSingleProps<V>;
  return (
    <RadixToggleGroup.Root
      type="single"
      value={single.value}
      onValueChange={(v) => {
        if (v) single.onChange(v as V);
      }}
      {...common}
    >
      {items}
    </RadixToggleGroup.Root>
  );
}
