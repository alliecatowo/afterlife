/**
 * `RulesPanel` exercised as a presentational component against a mocked
 * `@/ui/session` — `Session.setRule`'s actual fresh-world behaviour is
 * covered end to end in `tests/core-engine-rules.test.ts`/
 * `tests/core-rule.test.ts`; this file is about the panel showing the right
 * thing and calling `setRule` with the right argument.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { RULE_PRESETS } from '@/content/rules';

let mockRule = 'B3/S23';
const mockSetRule = vi.fn((rule: string) => true);

vi.mock('@/ui/session', () => ({
  getSession: () => ({ engine: { rule: mockRule }, setRule: mockSetRule }),
}));

import { RulesPanel } from '@/ui/panels/RulesPanel';

afterEach(() => {
  cleanup();
  mockRule = 'B3/S23';
  mockSetRule.mockClear();
});

describe('RulesPanel — reading the active rule', () => {
  it('shows the active rule in the readout', () => {
    mockRule = 'B36/S23';
    render(<RulesPanel />);
    expect(screen.getByText('active rule').parentElement?.textContent).toContain('B36/S23');
  });

  it('marks the matching preset as Active and disables its own button', () => {
    mockRule = 'B36/S23';
    render(<RulesPanel />);
    const activeButtons = screen.getAllByText('Active');
    expect(activeButtons).toHaveLength(1);
    expect((activeButtons[0] as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows the leaving-Conway warning only when the active rule is not Conway', () => {
    mockRule = 'B3/S23';
    const { rerender } = render(<RulesPanel />);
    expect(screen.queryByRole('status')).toBeNull();

    mockRule = 'B36/S23';
    rerender(<RulesPanel />);
    expect(screen.getByRole('status').textContent).toMatch(/verified under Conway/i);
  });

  it('lists every shipped preset with its description and verified claim', () => {
    render(<RulesPanel />);
    for (const preset of RULE_PRESETS) {
      expect(screen.getByText(preset.name)).toBeTruthy();
    }
  });
});

describe('RulesPanel — switching presets', () => {
  it('clicking a non-active preset calls session.setRule with its canonical rulestring', () => {
    mockRule = 'B3/S23';
    render(<RulesPanel />);
    const highlife = RULE_PRESETS.find((p) => p.id === 'highlife')!;
    fireEvent.click(screen.getByLabelText(`Switch to ${highlife.name} (${highlife.rule})`));
    expect(mockSetRule).toHaveBeenCalledWith(highlife.rule);
  });
});

describe('RulesPanel — custom rulestring entry', () => {
  it('disables Apply until a valid rulestring is entered, and shows an error for an invalid one', () => {
    render(<RulesPanel />);
    const input = screen.getByLabelText('Custom rulestring') as HTMLInputElement;
    const apply = screen.getByText('Apply') as HTMLButtonElement;
    expect(apply.disabled).toBe(true);

    fireEvent.change(input, { target: { value: 'nonsense' } });
    expect(apply.disabled).toBe(true);
    expect(screen.getByText(/not a recognised B\/S rulestring|Unsupported or invalid rule/i)).toBeTruthy();

    fireEvent.change(input, { target: { value: 'B36/S23' } });
    expect(apply.disabled).toBe(false);
  });

  it('applying a valid custom rulestring calls session.setRule with the typed value', () => {
    render(<RulesPanel />);
    const input = screen.getByLabelText('Custom rulestring') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'b2/s' } });
    fireEvent.click(screen.getByText('Apply'));
    expect(mockSetRule).toHaveBeenCalledWith('b2/s');
  });

  it('names the specific unsupported family for a Generations-style rule', () => {
    render(<RulesPanel />);
    const input = screen.getByLabelText('Custom rulestring') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'B3/S23/3' } });
    expect(input.getAttribute('aria-invalid')).toBe('true');
    const errors = screen.getAllByText(/Generations/i).filter((el) => el.tagName === 'P' && el.className.includes('accent-warn'));
    expect(errors.length).toBe(1);
  });
});
