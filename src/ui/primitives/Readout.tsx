import { forwardRef } from 'react';
import type { HTMLAttributes, ReactNode } from 'react';

export interface ReadoutProps extends HTMLAttributes<HTMLDivElement> {
  label: string;
  value: ReactNode;
  unit?: string;
  /** Character-width reserved for the value so digits never reflow. */
  digits?: number;
  /** Paints the value in the given accent when the concept genuinely is that accent. */
  accent?: 'life' | 'age' | 'activity' | 'time' | 'warn' | 'diff' | 'branch-a' | 'branch-b' | null;
  size?: 'sm' | 'md';
}

const accentClass: Record<string, string> = {
  life: 'text-accent-life',
  age: 'text-accent-age',
  activity: 'text-accent-activity',
  time: 'text-accent-time',
  warn: 'text-accent-warn',
  diff: 'text-accent-diff',
  'branch-a': 'text-accent-branch-a',
  'branch-b': 'text-accent-branch-b',
};

/**
 * Tabular-numeral readout with a fixed-width value slot. Use the `ref`'d
 * value span to write straight from a bus handler for zero-render counters
 * (see `@/ui/hooks/useSimulationReadout`).
 */
export const Readout = forwardRef<HTMLSpanElement, ReadoutProps>(function Readout(
  { label, value, unit, digits = 6, accent = null, size = 'sm', className = '', ...props },
  ref,
) {
  return (
    <div className={`flex flex-col gap-0.5 leading-none ${className}`} {...props}>
      <span className="text-micro uppercase tracking-[0.18em] text-ivory-300">{label}</span>
      <span className="flex items-baseline gap-1">
        <span
          ref={ref}
          className={`tabular text-right ${size === 'md' ? 'text-lg' : 'text-sm'} ${accent ? accentClass[accent] : 'text-ivory-100'}`}
          style={{ minWidth: `${digits}ch`, display: 'inline-block' }}
        >
          {value}
        </span>
        {unit ? <span className="text-micro text-ivory-300">{unit}</span> : null}
      </span>
    </div>
  );
});
