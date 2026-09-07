import * as RadixSlider from '@radix-ui/react-slider';

export interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  onCommit?: (value: number) => void;
  /** Formats the tabular readout shown to the right of the track. */
  format?: (value: number) => string;
  disabled?: boolean;
  className?: string;
}

/** Radix Slider painted with tokens; keyboard-steppable, tabular value readout. */
export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  onCommit,
  format = (v) => String(v),
  disabled,
  className = '',
}: SliderProps) {
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <div className="flex items-baseline justify-between">
        <span className="text-micro uppercase tracking-[0.18em] text-ivory-300">{label}</span>
        <span className="tabular text-xs text-ivory-100">{format(value)}</span>
      </div>
      <RadixSlider.Root
        className="relative flex h-5 w-full touch-none select-none items-center"
        min={min}
        max={max}
        step={step}
        value={[value]}
        disabled={disabled}
        onValueChange={([v]) => v !== undefined && onChange(v)}
        onValueCommit={([v]) => v !== undefined && onCommit?.(v)}
      >
        <RadixSlider.Track className="relative h-[3px] grow rounded-full bg-ink-600">
          <RadixSlider.Range className="absolute h-full rounded-full bg-ivory-200" />
        </RadixSlider.Track>
        <RadixSlider.Thumb
          className={
            'block h-3.5 w-3.5 rounded-full border border-line-strong bg-ivory-100 shadow-[var(--shadow-inset)] ' +
            'transition-colors focus-visible:focus-ring outline-none hover:bg-ivory-200 active:bg-ivory-300 ' +
            'disabled:bg-ink-500 max-[480px]:h-5 max-[480px]:w-5'
          }
          aria-label={label}
        />
      </RadixSlider.Root>
    </div>
  );
}
