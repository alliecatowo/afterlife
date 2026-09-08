/**
 * The guided tour's script — what each step says and what real place or
 * control it points at. Owned by the `tutorial` work: this file is pure data
 * (no DOM, no bus, no React), exactly like `@/content/scenes`'s `SceneDef`s.
 * The imperative half — how a step detects the real action that completes
 * it, and how "show me" performs that action — lives in
 * `@/ui/tutorial/behaviors.ts`, keyed by the same `TourStepId`.
 *
 * Voice: natural-history-plate, per DESIGN.md — precise, unfussy, one or two
 * sentences, no exclamation marks, no emoji.
 */
import type { CellCoord } from '@/core/types';
import { OPENING_VERIFIED } from '@/content/scenes';

export type TourStepId =
  | 'welcome'
  | 'encounter'
  | 'transport'
  | 'draw'
  | 'stamp'
  | 'lenses'
  | 'ribbon'
  | 'fork'
  | 'sculpture'
  | 'field-guide'
  | 'experiments'
  | 'completion';

/**
 * Where a step's coach mark anchors itself. `selector` tries each CSS
 * selector in order and uses the first that resolves to a visible
 * (non-zero-area) element — later entries are deliberately coarser
 * fallbacks (e.g. the whole HUD band) for controls that are hidden on a
 * narrow viewport, so a step never points at nothing on mobile. `role`
 * matches by ARIA role + accessible name (text content or `aria-label`),
 * for controls (Radix radio items, headings) that don't carry a stable
 * selector of their own. `world` anchors to a live world coordinate via the
 * renderer, the same mechanism `@/ui/SceneAnnotation` already uses. `center`
 * has no target at all — a quiet card in the middle of the screen.
 */
export type TourTarget =
  | { kind: 'center' }
  | { kind: 'selector'; selectors: readonly string[] }
  | { kind: 'role'; role: string; name: string }
  | { kind: 'world'; at: CellCoord };

export interface TourStepContent {
  id: TourStepId;
  /** Short label. Rendered as styled text, never a heading element — see
   *  `CoachMark`'s doc for why (the same reasoning as `TitlePlate`'s `<p>`). */
  title: string;
  /** One or two sentences. */
  body: string;
  target: TourTarget;
  placement: 'top' | 'bottom' | 'left' | 'right';
  /** Label for the button that performs this step's action on the user's
   *  behalf, if `@/ui/tutorial/behaviors.ts` defines one for this step. */
  showMeLabel?: string;
}

export const TOUR_STEPS: readonly TourStepContent[] = [
  {
    id: 'welcome',
    title: 'Afterlife',
    body:
      "This is Conway's Life: a grid of cells that live, die and are born by three fixed rules, running " +
      'continuously in front of you. Every future that unfolds here leaves a trace — you can scrub back ' +
      'through it, fork it, and hold its shape in your hands.',
    target: { kind: 'center' },
    placement: 'bottom',
  },
  {
    id: 'encounter',
    title: 'The living world',
    body:
      'A cell survives with two or three living neighbors, is born with exactly three, and dies otherwise — ' +
      'that is the entire rule set. Two travelers are crossing the empty south of this world and are about ' +
      'to meet; watch the marker where they do.',
    target: { kind: 'world', at: OPENING_VERIFIED.firstInteractingCell },
    placement: 'top',
    showMeLabel: 'Rewind and watch it happen',
  },
  {
    id: 'transport',
    title: 'Pause, step, speed',
    body:
      'Space stops time completely; the step keys beside it move one generation at a time; the bracket keys ' +
      'change how fast it runs. Press space now and watch everything hold still.',
    target: { kind: 'selector', selectors: ['[aria-label="Pause"]', '[aria-label="Play"]', '#hud-top'] },
    placement: 'bottom',
    showMeLabel: 'Pause it for me',
  },
  {
    id: 'draw',
    title: 'Drawing and erasing',
    body:
      'The pencil brings a cell to life with a click or a drag; the eraser takes one away the same way. ' +
      'Try it on any empty patch of the world.',
    target: { kind: 'role', role: 'radio', name: 'Draw' },
    placement: 'right',
    showMeLabel: 'Draw a cell for me',
  },
  {
    id: 'stamp',
    title: 'The specimen drawer',
    body:
      'The drawer catalogs known structures — gliders, oscillators, still lifes — ready to stamp onto the ' +
      'world instead of drawn cell by cell. Pick one, then click to place it.',
    target: { kind: 'role', role: 'heading', name: 'Patterns' },
    placement: 'right',
    showMeLabel: 'Arm a specimen for me',
  },
  {
    id: 'lenses',
    title: 'Lenses and the legend',
    body:
      "The life lens shows what's alive right now; age shows how long each cell has persisted; activity " +
      'shows where the world has recently changed. Press 1, 2 or 3 to switch — the legend beside the toggle ' +
      'explains whichever is active.',
    target: { kind: 'selector', selectors: ['[aria-label="Render lens"]', '#hud-top'] },
    placement: 'bottom',
    showMeLabel: 'Switch the lens for me',
  },
  {
    id: 'ribbon',
    title: 'The history ribbon',
    body:
      "Every generation this session has run is recorded here — drag to scrub backward through it, or use " +
      'the arrow keys once it is focused. Nothing is lost by looking at the past.',
    target: { kind: 'selector', selectors: ['[aria-label="History timeline"]', '#timeline'] },
    placement: 'top',
    showMeLabel: 'Scrub backward for me',
  },
  {
    id: 'fork',
    title: 'Editing the past',
    body:
      "Change a cell at a generation you've scrubbed back to, and the original future isn't erased — a new " +
      'branch forks from that moment, and both are kept. Open Compare to watch them side by side.',
    target: { kind: 'selector', selectors: ['#world-canvas'] },
    placement: 'bottom',
    showMeLabel: 'Fork a branch for me',
  },
  {
    id: 'sculpture',
    title: 'The Time Sculpture',
    body:
      'Select a region of the world, then open the Time Sculpture to lift its recorded history into a ' +
      'three-dimensional stack — one slice per generation, time made a shape you can walk around.',
    target: { kind: 'selector', selectors: ['[aria-label="Open time sculpture"]', '[aria-label="Close time sculpture"]', '#hud-top'] },
    placement: 'bottom',
    showMeLabel: 'Open the sculpture for me',
  },
  {
    id: 'field-guide',
    title: 'The Field Guide',
    body:
      'As structures are recognized — a glider, a block, a pulsar — they are logged here on their own, with ' +
      'the option to name, follow, or return to any of them.',
    target: { kind: 'selector', selectors: ['[aria-label="Field guide"]', '#hud-top'] },
    placement: 'bottom',
    showMeLabel: 'Open the Field Guide for me',
  },
  {
    id: 'experiments',
    title: 'The experiments',
    body:
      'Three authored challenges live here, each a seeded world with a real question to answer by editing ' +
      'it — the same tools as everywhere else, aimed at a specific outcome.',
    target: { kind: 'selector', selectors: ['[aria-label="Experiments"]', '#hud-top'] },
    placement: 'bottom',
    showMeLabel: 'Open Experiments for me',
  },
  {
    id: 'completion',
    title: "That's the instrument",
    body:
      'Everything from here is yours to find. Replay this tour anytime from the compass beside the ' +
      'shortcuts sheet.',
    target: { kind: 'center' },
    placement: 'bottom',
  },
];

/** Copy for the compact "What is this?" affordance — reachable at any time, independent of the tour. */
export const ABOUT_CONTENT = {
  title: 'What is this',
  paragraphs: [
    "AFTERLIFE is a place to visit Conway's Game of Life, not just watch it run: a cell survives with two " +
      'or three living neighbors, is born with exactly three, and dies otherwise. From those three rules ' +
      'alone, gliders travel, guns fire, and gardens of still shapes hold their ground.',
    'Every generation this session runs is recorded, so the past is never gone — scrub back through it, ' +
      'change a single cell, and watch a new future fork from the original while the old one is kept. The ' +
      'Time Sculpture lifts that recorded history into a shape you can walk around.',
  ],
} as const;
