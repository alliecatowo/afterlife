/**
 * Top-level error boundary. Without one, a render error anywhere (the lazy
 * WebGL sculpture is the likeliest) unmounts the whole tree to a blank page.
 * The fallback offers a plain reload and a "reset local data" escape hatch for
 * the case where a corrupt autosave is what keeps crashing the app.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { STORAGE_PREFIX } from '@/persist/store';

interface State {
  error: Error | null;
}

export function resetLocalData(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(STORAGE_PREFIX)) keys.push(k);
    }
    for (const k of keys) localStorage.removeItem(k);
  } catch {
    // storage unavailable: nothing to reset
  }
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[afterlife] render error', error, info.componentStack);
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    const button = {
      font: 'inherit',
      padding: '8px 14px',
      borderRadius: 6,
      border: '1px solid currentColor',
      background: 'transparent',
      color: 'inherit',
      cursor: 'pointer',
    } as const;
    return (
      <div
        role="alert"
        style={{
          position: 'fixed',
          inset: 0,
          display: 'grid',
          placeContent: 'center',
          gap: 14,
          padding: 24,
          textAlign: 'center',
          background: 'var(--color-ink-900, #0b1214)',
          color: '#e8e6df',
          fontFamily: 'var(--font-display, serif)',
        }}
      >
        <h1 style={{ margin: 0, fontSize: 28 }}>Something went wrong</h1>
        <p style={{ margin: 0, opacity: 0.75, maxWidth: 440 }}>
          AFTERLIFE hit an unexpected error. Reloading usually fixes it; if it keeps happening, reset the locally saved data.
        </p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
          <button type="button" style={button} onClick={() => location.reload()}>Reload</button>
          <button
            type="button"
            style={button}
            onClick={() => {
              resetLocalData();
              location.reload();
            }}
          >
            Reset local data
          </button>
        </div>
      </div>
    );
  }
}
