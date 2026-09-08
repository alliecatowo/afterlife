/**
 * Pick a curated rule preset, or type a custom B/S rulestring, with live
 * validation. Owned by `core` (rule-generalisation pass) — new file, not a
 * `ui`-owned one; follows the existing panel vocabulary
 * (`@/ui/primitives`) and `ExperimentsPanel`'s "list of cards" layout.
 *
 * Switching rules is a FRESH-WORLD operation (see `Session.setRule`'s doc
 * and `LifeEngine.setRule`'s doc in `@/core/engine.ts`): it clears the world
 * and starts a new root branch at generation 0, exactly like loading a
 * scene. This panel does not pretend otherwise — the copy says so.
 *
 * Reactivity note: rule changes are rare, discrete user actions (this panel,
 * or loading a curated scene/specimen which always forces Conway back — see
 * `session.ts`'s `loadScene`), never a per-generation signal. Rather than
 * inventing a new bus event in the frozen `@/ui/bus.ts`, this panel uses the
 * already-sanctioned `useSimulationReadout()` bridge purely as a <=10Hz
 * re-render tick (its own `gen` value is unused here) so the displayed
 * "active rule" line stays honest even if something else changes it while
 * this panel happens to be open — see INTEGRATION-NOTES.md for the same
 * pattern proposed for the HUD's own readout.
 */
import { useState } from 'react';
import { getSession } from '@/ui/session';
import { useSimulationReadout } from '@/ui/hooks/useSimulationReadout';
import { RULE_PRESETS, findPresetByRule } from '@/content/rules';
import { CONWAY_RULE_STRING, RuleParseError, parseRule } from '@/core/rule';
import { Button, Divider, Field, Readout } from '@/ui/primitives';

const LEAVING_CONWAY_WARNING =
  "Every curated scene, specimen, and experiment in AFTERLIFE was verified under Conway's Life (B3/S23) — " +
  'their described periods, stability, and outcomes will not hold under a different rule. Loading any of ' +
  "them always switches the world back to B3/S23 first, so your own experiments here are never at risk.";

export function RulesPanel() {
  const session = getSession();
  // See the module doc: a <=10Hz re-render tick, not a per-generation one —
  // `gen` itself is unused, we just want React to re-check `session.engine.rule`.
  useSimulationReadout();
  const activeRule = session?.engine.rule ?? CONWAY_RULE_STRING;

  const [custom, setCustom] = useState('');
  const [customError, setCustomError] = useState<string | null>(null);

  const activePreset = findPresetByRule(activeRule);
  const isConway = activeRule === CONWAY_RULE_STRING;

  const apply = (ruleString: string): void => {
    if (!session) return;
    const ok = session.setRule(ruleString);
    if (ok) setCustom('');
  };

  const onCustomChange = (value: string): void => {
    setCustom(value);
    if (value.trim().length === 0) {
      setCustomError(null);
      return;
    }
    try {
      parseRule(value);
      setCustomError(null);
    } catch (err) {
      setCustomError(err instanceof RuleParseError ? err.message : 'Not a valid rulestring.');
    }
  };

  const canApplyCustom = custom.trim().length > 0 && customError === null;

  return (
    <div className="flex flex-col gap-4">
      <Readout label="active rule" value={activeRule} digits={Math.max(8, activeRule.length)} />

      {!isConway && (
        <p role="status" className="rounded-sm border border-line bg-ink-800 px-2.5 py-2 text-xs text-accent-warn">
          {LEAVING_CONWAY_WARNING}
        </p>
      )}

      <Divider />

      <Field label="Presets" description="Each has a verified headline claim — see the description below it.">
        <ul className="flex flex-col gap-2">
          {RULE_PRESETS.map((preset) => {
            const active = preset.rule === activeRule;
            return (
              <li key={preset.id} className="flex flex-col gap-1.5 rounded-sm border border-line px-2.5 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm text-ivory-100">{preset.name}</span>
                  <span className="text-micro tabular text-ivory-300">{preset.rule}</span>
                </div>
                <p className="text-xs text-ivory-300">{preset.description}</p>
                <p className="text-xs text-ivory-200">
                  <span className="text-micro uppercase tracking-[0.1em] text-ivory-300">Verified: </span>
                  {preset.verified}
                </p>
                <Button
                  variant={active ? 'solid' : 'ghost'}
                  pressed={active}
                  disabled={active}
                  onClick={() => apply(preset.rule)}
                  aria-label={`Switch to ${preset.name} (${preset.rule})`}
                >
                  {active ? 'Active' : 'Switch to this rule'}
                </Button>
              </li>
            );
          })}
        </ul>
      </Field>

      <Divider />

      <Field
        label="Custom rulestring"
        htmlFor="rules-panel-custom"
        description={
          activePreset === undefined && !isConway
            ? `Currently running a custom rule not in the preset list above (${activeRule}).`
            : 'B/S notation, e.g. "B3/S23" or "B36/S23". Also accepts "S23/B3" and the historic "23/3".'
        }
        error={customError}
      >
        <div className="flex gap-2">
          <input
            id="rules-panel-custom"
            type="text"
            value={custom}
            onChange={(e) => onCustomChange(e.target.value)}
            placeholder="B3/S23"
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            className="h-8 min-w-0 flex-1 rounded-sm border border-line bg-ink-900 px-2 text-xs text-ivory-100 outline-none focus-visible:focus-ring"
            aria-invalid={customError !== null}
          />
          <Button variant="solid" size="sm" disabled={!canApplyCustom} onClick={() => apply(custom)}>
            Apply
          </Button>
        </div>
      </Field>
    </div>
  );
}
