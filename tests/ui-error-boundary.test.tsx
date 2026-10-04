// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { ErrorBoundary } from '@/ui/ErrorBoundary';

function Boom(): never {
  throw new Error('boom');
}

describe('ErrorBoundary', () => {
  it('shows a recovery fallback instead of a blank page', async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const host = document.createElement('div');
    document.body.appendChild(host);
    await act(async () => {
      createRoot(host).render(<ErrorBoundary><Boom /></ErrorBoundary>);
    });
    expect(host.textContent).toContain('Something went wrong');
    expect(host.textContent).toContain('Reset local data');
    spy.mockRestore();
  });
});
