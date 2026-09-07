export interface DividerProps {
  orientation?: 'horizontal' | 'vertical';
  className?: string;
}

/** A hairline. The only elevation tool DESIGN.md wants reached for first. */
export function Divider({ orientation = 'horizontal', className = '' }: DividerProps) {
  if (orientation === 'vertical') {
    return <div role="separator" aria-orientation="vertical" className={`w-px self-stretch bg-line ${className}`} />;
  }
  return <div role="separator" aria-orientation="horizontal" className={`h-px w-full bg-line ${className}`} />;
}
