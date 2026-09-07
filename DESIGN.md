# AFTERLIFE — Design System

> A contemporary natural-history observatory crossed with a precision musical instrument.

This document is normative. Six agents build this app; this is what keeps it looking
like one thing. If a decision isn't here, ask in `INTEGRATION-NOTES.md` — don't invent
a second visual language.

## 0. What this is not

- Not a dashboard. Not a shadcn app. Not a "dark SaaS" app.
- **Banned:** purple/indigo gradients, glassmorphism/backdrop-blur cards, emoji in UI,
  drop shadows used as glow, `rounded-xl` card soup, decorative icon chips, stock
  gradient hero text, Tailwind's default palette (`slate-`, `zinc-`, `blue-500`, …).
- **Wanted:** hairlines, generous negative space around the world, restrained colour used
  as *information*, tabular numerals, an editorial serif used sparingly and at size only.

## 1. Palette — each colour has ONE fixed meaning

Tokens live in `src/styles/tokens.css` as Tailwind `@theme` values, so every token is a
utility (`bg-ink-800`, `text-accent-life`, `border-line`).

### Ground and figure

| Token | Use |
| --- | --- |
| `--color-ink-900` | Page ground. The void the universe sits in. Nothing else. |
| `--color-ink-800` | Chrome surfaces: HUD, drawer, panel, timeline. |
| `--color-ink-700` | Raised surfaces: popovers, dialogs, menus. |
| `--color-ink-600` | Pressed/active chrome; deep grid lines. |
| `--color-ink-500` | Disabled foreground; faded sculpture slices. |
| `--color-ivory-100` | Primary text, headings, the value in a readout. |
| `--color-ivory-200` | Body text, control labels. |
| `--color-ivory-300` | Secondary text, units, captions, axis ticks. |
| `--color-surface` / `--color-surface-raised` | Semantic aliases for panel/overlay fills. |
| `--color-line` / `--color-line-strong` | Hairlines. `strong` only for the active edge. |
| `--color-focus` | Focus ring. Never used for anything else. |

### Accents — meanings are immutable

| Token | Means | Appears in |
| --- | --- | --- |
| `--color-accent-life` | A living cell; healthy population | life lens, population readout, play state |
| `--color-accent-age` | Persistence / how long a cell has lived | age lens and its legend ramp |
| `--color-accent-activity` | Recent change, churn, heat | activity lens, birth/death sparkline |
| `--color-accent-time` | Time itself: scrubbing, history, the sculpture | timeline, slice plane, gen readout while scrubbing |
| `--color-accent-branch-a` | Branch A in any comparison | branch chips, diff legend, compare canvas |
| `--color-accent-branch-b` | Branch B in any comparison | as above |
| `--color-accent-diff` | Cells that differ between branches | diff overlay, diff count |
| `--color-accent-warn` | Destructive or attention-needing | reset, discard-future confirm, storage-full toast |

Rules: never colour a control by an accent unless the control *is* that concept. Never use
two accents in one component to add visual interest. Accents are ~5% of pixels.

## 2. Typography

Three self-hosted variable faces (bundled via `@fontsource-variable/*`, zero network at runtime).

- **Display — Fraunces Variable** (`--font-display`). Used only at `--text-lg` and above:
  the wordmark, panel titles, dialog titles, empty-state lines. Tuned deliberately via the
  `display-face` utility (`SOFT 28, WONK 1, opsz 88`) — the high optical size gives fine
  hairlines suited to display sizes, and a single notch of `WONK` supplies the engraved
  natural-history-plate character. `display-face-tight` (`SOFT 12, WONK 0, opsz 42`) is the
  variant for smaller headings where wonk would read as sloppy. **Never set Fraunces at
  defaults, and never below 18px.**
- **UI — Inter Variable** (`--font-sans`). Everything else. Default UI size is
  `--text-sm` (13px); `--text-micro` (11px) for uppercase labels with `0.18em` tracking.
- **Numerals — JetBrains Mono Variable** (`--font-mono`) via the `tabular` utility, which
  sets `font-variant-numeric: tabular-nums` + `tnum`/`zero`. **Every** number that changes
  over time (generation, population, coordinates, speed, diff count, FPS) uses `tabular`,
  so digits never reflow.

Type scale: `--text-micro` 11 · `--text-xs` 12 · `--text-sm` 13 · `--text-base` 15 ·
`--text-lg` 18 · `--text-display` 28 · `--text-display-lg` 44.

## 3. Space, radius, elevation

- Spacing base is 4px (`--spacing`). Use the Tailwind scale: `1`=4, `2`=8, `3`=12, `4`=16,
  `6`=24, `8`=32. Control padding is `px-3 py-1.5` (sm) or `px-4 py-2` (md).
- Radius is architectural and small: `--radius-xs` 2 (swatches), `--radius-sm` 3 (inputs,
  buttons), `--radius-md` 5 (panels, popovers), `--radius-lg` 8 (dialogs),
  `--radius-full` (toggle thumbs only). Nothing else is pill-shaped.
- Elevation is a hairline first, a shadow second. `--shadow-hairline` for inline surfaces,
  `--shadow-raise` for popovers/menus, `--shadow-float` for dialogs. `--shadow-inset` adds
  the single top highlight that makes a control feel machined. No coloured shadows, ever.

## 4. Motion

`--duration-instant` 80ms (state feedback: hover, press) · `--duration-fast` 140ms
(tooltips, toggles) · `--duration-base` 220ms (panels, popovers, toasts) ·
`--duration-slow` 400ms (sculpture open/close, presentation mode).

Easing: `--ease-standard` for on-screen changes, `--ease-entrance` for things arriving,
`--ease-exit` for things leaving. Motion is translate + opacity only — no scale bounce, no
spring overshoot, nothing rotates for fun.

`prefers-reduced-motion: reduce` zeroes all four durations in `tokens.css` and `base.css`
kills transitions globally. Any `motion` animation must additionally check
`useReducedMotion()` and render the end state directly.

## 5. Interaction states (mandatory on every primitive)

| State | Treatment |
| --- | --- |
| rest | `text-ivory-200`, transparent fill, `border-line` where bordered |
| hover | fill lifts one ink step (`ink-800` → `ink-700`), text to `ivory-100`, 80ms |
| active/press | fill drops to `ink-600`, no transform bounce |
| focus-visible | `outline: 2px solid var(--color-focus); outline-offset: 2px` — the `focus-ring` utility. Identical everywhere. |
| selected/on | `border-line-strong` + the concept's accent as a 2px inline marker, not a fill |
| disabled | `text-ink-500`, `cursor: not-allowed`, no hover response, `aria-disabled` |

Everything is keyboard-operable. Radix supplies the roles and focus management; we supply
only the paint. Never remove an outline without replacing it.

## 6. Composition

**The world dominates; controls hold a slim perimeter.** The canvas is the only element
allowed to be large. Chrome sits in fixed bands (`--size-hud` 48px top, `--size-timeline`
72px bottom, `--size-drawer` 240px left, `--size-panel` 304px right) separated from the
world by a single hairline — no gaps, no floating cards over the simulation except
transient toasts and the ghost preview.

Panels are stacked sections separated by hairlines, each with an 11px uppercase
`--text-micro` label. No nested borders. Presentation mode hides drawer, panel and HUD,
leaving the world and a 1-line tabular readout.

## 7. Component vocabulary (`src/ui/primitives/`)

Built on Radix primitives, unstyled, painted only with tokens:
`Button` (solid | ghost | quiet × sm | md), `IconButton` (requires `label`), `Toggle`
(ToggleGroup), `Slider`, `Panel`, `Field`/`Label`, `Tooltip`, `Readout` (tabular, fixed
width), `Legend` (swatch + meaning), `Divider`, `Toast`.

No component may hardcode a hex/oklch colour, a px radius, or a duration — token or
nothing. If you need a value that doesn't exist, propose it in `INTEGRATION-NOTES.md`;
do not edit `tokens.css`.
