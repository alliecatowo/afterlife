import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { bus } from '@/ui/bus';
import { WarningIcon, CheckIcon, DotIcon } from '@/ui/icons';

interface ToastItem {
  id: number;
  message: string;
  tone: 'info' | 'warn' | 'success';
  ms: number;
}

let nextId = 1;

const toneIcon: Record<ToastItem['tone'], React.ReactNode> = {
  info: <DotIcon className="text-accent-time" />,
  warn: <WarningIcon className="text-accent-warn" />,
  success: <CheckIcon className="text-accent-life" />,
};

const toneLabel: Record<ToastItem['tone'], string> = {
  info: 'Note',
  warn: 'Warning',
  success: 'Done',
};

/**
 * Subscribes to the bus `toast` event and renders into `#toast-layer`
 * (declared by `App.tsx`). Mount once, near the app root. Tone is never the
 * only cue — an icon and a text label always pair with it.
 */
export function ToastLayer() {
  const [items, setItems] = useState<ToastItem[]>([]);
  const [host, setHost] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setHost(document.getElementById('toast-layer'));
    const sub = bus.on('toast', ({ message, tone = 'info', ms = 4200 }) => {
      const id = nextId++;
      setItems((prev) => [...prev, { id, message, tone, ms }]);
      window.setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), ms);
    });
    return () => sub.dispose();
  }, []);

  if (!host) return null;

  return createPortal(
    <div className="flex flex-col items-center gap-2">
      {items.map((t) => (
        <div
          key={t.id}
          role="status"
          className={
            'pointer-events-auto flex items-center gap-2 rounded-md border border-line bg-surface-raised px-3 py-2 ' +
            'text-xs text-ivory-200 shadow-[var(--shadow-raise)] ' +
            'animate-[toast-in_var(--duration-base)_var(--ease-entrance)]'
          }
        >
          {toneIcon[t.tone]}
          <span className="sr-only">{toneLabel[t.tone]}:</span>
          <span>{t.message}</span>
        </div>
      ))}
    </div>,
    host,
  );
}
