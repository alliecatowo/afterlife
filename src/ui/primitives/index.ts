/**
 * The AFTERLIFE component vocabulary. Owned by the `ui` agent
 * (`src/ui/primitives/**`). Every primitive is built on Radix (unstyled) and
 * styled ONLY with theme tokens — see DESIGN.md for the rules.
 *
 * Required members (keep this list in sync as you implement; a file that does
 * not exist yet simply is not re-exported):
 *   Button      variants: solid | ghost | quiet;  sizes: sm | md
 *   IconButton  square Button with a required `label` for a11y
 *   Toggle      Radix ToggleGroup based, single or multiple
 *   Slider      Radix Slider, tabular value readout, keyboard steppable
 *   Panel       titled surface with a hairline and optional collapse
 *   Field/Label form row with description + error slots
 *   Tooltip     Radix Tooltip with our delay + motion tokens
 *   Readout     tabular numerals, fixed width, no layout jitter
 *   Legend      swatch + meaning rows, drives the lens legend
 *   Divider     hairline, horizontal or vertical
 *   Toast       transient notice rendered into #toast-layer
 *
 * Non-negotiable for all of them: real hover / active / focus-visible /
 * disabled states from tokens, full keyboard operation, no emoji, no
 * glassmorphism, no default shadcn styling.
 */
export {};
