/**
 * Appearance: pick a shipped theme, build/edit a custom one from the 8
 * semantic accent slots, import/export as JSON, reset to the Observatory
 * default. Live-preview: every edit applies to the DOM immediately (see
 * `useThemeStore.setDraftAccent`), nothing waits for "Save".
 */
import { useMemo, useRef, useState } from 'react';
import { useThemeStore } from '@/ui/theme/store';
import { BUILTIN_THEMES, getBuiltinTheme, type ThemeDefinition } from '@/ui/theme/themes';
import { customThemeAsDefinition, type CustomTheme } from '@/ui/theme/custom';
import { ACCENT_LABELS, ACCENT_TOKENS, type AccentToken } from '@/ui/theme/tokens';
import { oklchToHex, hexToOklchString, parseOklch } from '@/ui/theme/color';
import { contrastReport, accentDistances, MIN_ACCENT_DISTANCE } from '@/ui/theme/validate';
import { Button, Field, Divider, IconButton } from '@/ui/primitives';
import { DownloadIcon, UploadIcon, PencilIcon, CheckIcon, CloseIcon } from '@/ui/icons';

function ThemeSwatch({ def }: { def: ThemeDefinition }) {
  const dots: AccentToken[] = ['--color-accent-life', '--color-accent-age', '--color-accent-activity', '--color-accent-warn'];
  return (
    <span className="flex items-center gap-1" aria-hidden="true">
      <span
        className="h-4 w-4 rounded-xs border border-line-strong"
        style={{ background: def.tokens['--color-ink-900'] }}
      />
      {dots.map((t) => (
        <span key={t} className="h-2 w-2 rounded-full" style={{ background: def.tokens[t] }} />
      ))}
    </span>
  );
}

function ThemeCard({ def, active, onSelect }: { def: ThemeDefinition; active: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onSelect}
      className={
        'flex w-full items-start gap-3 rounded-md border px-3 py-2.5 text-left transition-colors ' +
        'duration-[var(--duration-instant)] focus-visible:focus-ring outline-none hover:bg-ink-700 ' +
        (active ? 'border-line-strong bg-ink-700' : 'border-line bg-transparent')
      }
    >
      <ThemeSwatch def={def} />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="flex items-center gap-1.5 text-sm text-ivory-100">
          {def.name}
          {active ? <CheckIcon width={12} height={12} className="text-accent-life" /> : null}
        </span>
        <span className="text-xs text-ivory-300">{def.description}</span>
      </span>
    </button>
  );
}

export function ThemePanel() {
  const themeId = useThemeStore((s) => s.themeId);
  const customThemes = useThemeStore((s) => s.customThemes);
  const draft = useThemeStore((s) => s.draft);
  const setTheme = useThemeStore((s) => s.setTheme);
  const startEditing = useThemeStore((s) => s.startEditing);
  const setDraftName = useThemeStore((s) => s.setDraftName);
  const setDraftBase = useThemeStore((s) => s.setDraftBase);
  const setDraftAccent = useThemeStore((s) => s.setDraftAccent);
  const cancelEditing = useThemeStore((s) => s.cancelEditing);
  const saveDraft = useThemeStore((s) => s.saveDraft);
  const deleteCustomTheme = useThemeStore((s) => s.deleteCustomTheme);
  const resetToDefault = useThemeStore((s) => s.resetToDefault);
  const exportTheme = useThemeStore((s) => s.exportTheme);
  const importTheme = useThemeStore((s) => s.importTheme);

  const [importError, setImportError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const customDefs = useMemo(() => customThemes.map(customThemeAsDefinition), [customThemes]);

  const draftBase = draft ? getBuiltinTheme(draft.baseThemeId) ?? BUILTIN_THEMES[0] : null;
  const draftTokens = draft && draftBase ? { ...draftBase.tokens, ...draft.accents } : null;
  const draftReport = draftTokens ? contrastReport(draftTokens) : null;
  const draftDistances = draftTokens ? accentDistances(draftTokens) : null;
  const draftCollisions = draftDistances?.filter((d) => d.distance < MIN_ACCENT_DISTANCE) ?? [];

  const handleExport = (id: string) => {
    const json = exportTheme(id);
    if (!json) return;
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `afterlife-theme-${id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportFile = async (file: File) => {
    setImportError(null);
    const text = await file.text();
    const result = importTheme(text);
    if (!result.ok) setImportError(result.error);
  };

  if (draft) {
    return (
      <div className="flex flex-col gap-4">
        <Field label="Name" htmlFor="theme-draft-name">
          <input
            id="theme-draft-name"
            type="text"
            value={draft.name}
            onChange={(e) => setDraftName(e.target.value)}
            className="h-8 rounded-sm border border-line bg-ink-800 px-2 text-sm text-ivory-100 outline-none focus-visible:focus-ring"
          />
        </Field>

        <Field label="Based on" htmlFor="theme-draft-base" description="Chrome (surfaces, text, hairlines) comes from this theme. You only edit the 8 accent colours below.">
          <select
            id="theme-draft-base"
            value={draft.baseThemeId}
            onChange={(e) => setDraftBase(e.target.value)}
            className="h-8 rounded-sm border border-line bg-ink-800 px-2 text-sm text-ivory-100 outline-none focus-visible:focus-ring"
          >
            {BUILTIN_THEMES.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </Field>

        <Divider />

        <div className="flex flex-col gap-3">
          <span className="text-micro uppercase tracking-[0.18em] text-ivory-300">Accents</span>
          {ACCENT_TOKENS.map((token) => {
            const value = draftTokens?.[token] ?? '';
            let hex = '#888888';
            try { hex = oklchToHex(parseOklch(value)); } catch { /* keep fallback */ }
            return (
              <label key={token} className="flex items-center justify-between gap-3 text-xs text-ivory-200">
                <span className="min-w-0 flex-1">
                  <span className="block text-ivory-100">{ACCENT_LABELS[token]}</span>
                </span>
                <input
                  type="color"
                  aria-label={`${ACCENT_LABELS[token]} colour`}
                  value={hex}
                  onChange={(e) => {
                    try {
                      setDraftAccent(token, hexToOklchString(e.target.value));
                    } catch {
                      // invalid hex from the native picker — ignore, keep last good value
                    }
                  }}
                  className="h-7 w-11 shrink-0 cursor-pointer rounded-sm border border-line bg-transparent p-0 focus-visible:focus-ring outline-none"
                />
              </label>
            );
          })}
        </div>

        {draftCollisions.length > 0 ? (
          <p className="text-xs text-accent-warn">
            Too similar to distinguish: {draftCollisions.map((c) => `${ACCENT_LABELS[c.a as AccentToken] ?? c.a} / ${ACCENT_LABELS[c.b as AccentToken] ?? c.b}`).join(', ')}.
            Adjust one of each pair before saving.
          </p>
        ) : null}

        <Divider />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={cancelEditing}>Cancel</Button>
          <Button
            variant="solid"
            disabled={draftCollisions.length > 0}
            onClick={() => { const r = saveDraft(); if (!r.ok) setImportError(r.issues.join('; ')); }}
          >
            Save theme
          </Button>
        </div>
        {importError ? <p className="text-xs text-accent-warn">{importError}</p> : null}

        {draftReport ? (
          <>
            <Divider />
            <details className="text-xs text-ivory-300">
              <summary className="cursor-pointer text-micro uppercase tracking-[0.18em] text-ivory-300">Measured contrast</summary>
              <ul className="mt-2 flex flex-col gap-1">
                {draftReport.map((r) => (
                  <li key={r.label} className="tabular flex items-center justify-between gap-2">
                    <span className="text-ivory-300">{r.label}</span>
                    <span className={r.pass ? 'text-accent-life' : 'text-accent-warn'}>{r.ratio.toFixed(2)}:1</span>
                  </li>
                ))}
              </ul>
            </details>
          </>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div role="radiogroup" aria-label="Shipped themes" className="flex flex-col gap-2">
        <span className="text-micro uppercase tracking-[0.18em] text-ivory-300">Themes</span>
        {BUILTIN_THEMES.map((def) => (
          <ThemeCard key={def.id} def={def} active={themeId === def.id} onSelect={() => setTheme(def.id)} />
        ))}
      </div>

      <Divider />

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-micro uppercase tracking-[0.18em] text-ivory-300">Custom</span>
          <Button variant="ghost" size="sm" onClick={() => startEditing({ baseThemeId: themeId })}>New</Button>
        </div>
        {customDefs.length === 0 ? (
          <p className="text-xs text-ivory-300">No custom themes yet — start from a shipped one and adjust the 8 accents.</p>
        ) : (
          <ul className="flex flex-col gap-2" role="radiogroup" aria-label="Custom themes">
            {customDefs.map((def) => {
              const original = customThemes.find((c) => c.id === def.id) as CustomTheme;
              return (
                <li key={def.id} className="flex items-center gap-1.5">
                  <div className="min-w-0 flex-1">
                    <ThemeCard def={def} active={themeId === def.id} onSelect={() => setTheme(def.id)} />
                  </div>
                  <IconButton label={`Edit ${def.name}`} icon={<PencilIcon />} variant="ghost" onClick={() => startEditing({ existing: original })} />
                  <IconButton label={`Export ${def.name}`} icon={<DownloadIcon />} variant="ghost" onClick={() => handleExport(def.id)} />
                  <IconButton label={`Delete ${def.name}`} icon={<CloseIcon />} variant="ghost" onClick={() => deleteCustomTheme(def.id)} />
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <Divider />

      <div className="flex flex-wrap gap-2">
        <Button variant="ghost" size="sm" onClick={() => fileInputRef.current?.click()}>
          <UploadIcon /> Import
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json"
          className="sr-only"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleImportFile(f); e.target.value = ''; }}
        />
        <Button variant="ghost" size="sm" onClick={() => handleExport(themeId)}>
          <DownloadIcon /> Export current
        </Button>
        <Button variant="ghost" size="sm" onClick={resetToDefault}>Reset to Observatory</Button>
      </div>
      {importError ? <p className="text-xs text-accent-warn">{importError}</p> : null}
    </div>
  );
}
