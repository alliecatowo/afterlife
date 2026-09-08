/**
 * `ThemePanel` against the REAL theme store (small and pure enough not to
 * need mocking, same call as `tests/theme-store.test.ts` for the store
 * itself) — this file is about the panel showing/wiring the right things.
 * Fresh module registry per test (see that file's doc) since the store
 * applies its initial theme as a module-level side effect.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { BUILTIN_THEMES } from '@/ui/theme/themes';

async function freshPanel() {
  vi.resetModules();
  const { ThemePanel } = await import('@/ui/panels/ThemePanel');
  const { useThemeStore } = await import('@/ui/theme/store');
  return { ThemePanel, useThemeStore };
}

beforeEach(() => {
  window.localStorage.clear();
});
afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe('ThemePanel — picking a shipped theme', () => {
  it('lists every shipped theme with its name and description', async () => {
    const { ThemePanel } = await freshPanel();
    render(<ThemePanel />);
    for (const theme of BUILTIN_THEMES) {
      expect(screen.getByText(theme.name)).toBeTruthy();
      expect(screen.getByText(theme.description)).toBeTruthy();
    }
  });

  it('marks the active theme as checked and clicking another selects it', async () => {
    const { ThemePanel, useThemeStore } = await freshPanel();
    render(<ThemePanel />);
    const observatoryRadio = screen.getByRole('radio', { name: /Observatory/ });
    expect(observatoryRadio.getAttribute('aria-checked')).toBe('true');

    const phosphorRadio = screen.getByRole('radio', { name: /Phosphor/ });
    fireEvent.click(phosphorRadio);
    expect(useThemeStore.getState().themeId).toBe('phosphor');
  });
});

describe('ThemePanel — custom theme editor', () => {
  it('"New" opens an editor with a colour input per semantic accent', async () => {
    const { ThemePanel } = await freshPanel();
    render(<ThemePanel />);
    fireEvent.click(screen.getByText('New'));
    expect(screen.getByLabelText('Life colour')).toBeTruthy();
    expect(screen.getByLabelText('Diff colour')).toBeTruthy();
    expect(screen.getByLabelText('Warn colour')).toBeTruthy();
  });

  it('blocks saving a draft whose accents collide, with an explanatory message', async () => {
    const { ThemePanel } = await freshPanel();
    render(<ThemePanel />);
    fireEvent.click(screen.getByText('New'));

    const lifeInput = screen.getByLabelText('Life colour') as HTMLInputElement;
    const diffInput = screen.getByLabelText('Diff colour') as HTMLInputElement;
    fireEvent.change(diffInput, { target: { value: lifeInput.value } });

    expect(screen.getByText(/Too similar to distinguish/)).toBeTruthy();
    expect((screen.getByText('Save theme').closest('button') as HTMLButtonElement).disabled).toBe(true);
  });

  it('saving a valid draft returns to the theme list with the new theme selected', async () => {
    const { ThemePanel, useThemeStore } = await freshPanel();
    render(<ThemePanel />);
    fireEvent.click(screen.getByText('New'));
    fireEvent.click(screen.getByText('Save theme'));

    expect(useThemeStore.getState().customThemes).toHaveLength(1);
    expect(screen.getByText('Custom')).toBeTruthy();
  });

  it('Cancel discards the draft without creating a theme', async () => {
    const { ThemePanel, useThemeStore } = await freshPanel();
    render(<ThemePanel />);
    fireEvent.click(screen.getByText('New'));
    fireEvent.click(screen.getByText('Cancel'));
    expect(useThemeStore.getState().customThemes).toHaveLength(0);
    expect(screen.getByText('Themes')).toBeTruthy(); // back on the list view
  });
});

describe('ThemePanel — reset', () => {
  it('"Reset to Observatory" returns the active theme to Observatory', async () => {
    const { ThemePanel, useThemeStore } = await freshPanel();
    useThemeStore.getState().setTheme('cyanotype');
    render(<ThemePanel />);
    fireEvent.click(screen.getByText('Reset to Observatory'));
    expect(useThemeStore.getState().themeId).toBe('observatory');
  });
});
