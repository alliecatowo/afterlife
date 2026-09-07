import type { LabelHTMLAttributes, ReactNode } from 'react';

export function Label({ className = '', ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={`text-micro uppercase tracking-[0.18em] text-ivory-300 ${className}`}
      {...props}
    />
  );
}

export interface FieldProps {
  label: string;
  htmlFor?: string;
  description?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
  className?: string;
}

/** A labelled form row with description/error slots — used across Settings and dialogs. */
export function Field({ label, htmlFor, description, error, children, className = '' }: FieldProps) {
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {description && !error ? <p className="text-xs text-ivory-300">{description}</p> : null}
      {error ? <p className="text-xs text-accent-warn">{error}</p> : null}
    </div>
  );
}
