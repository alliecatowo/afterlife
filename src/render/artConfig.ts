/**
 * ACID ART: the whole configurable shape of Art mode — glyphs, the
 * modulation field, LFO automation, and colour. Owned by the `render` agent
 * (`src/render/**`). Pure data + pure helpers only; the zustand store lives
 * in `./artStore.ts`, the actual drawing in `./renderer.ts`.
 *
 * HONESTY BOUNDARY: this entire module is decoration layered on top of the
 * real, honest lenses (`@/core/types`' `RenderLens`) — nothing here can ever
 * change which cells are alive, and `DEFAULT_ART_CONFIG.enabled` is `false`,
 * so the app's default look is completely unchanged. `renderer.ts` only
 * consults this config when a caller explicitly turns Art mode on.
 */
import type { GlyphDriver, GlyphSetId } from './glyphs';
import { DEFAULT_CUSTOM_GLYPHS, GLYPH_DRIVERS, MAX_CUSTOM_GLYPHS, MIN_CUSTOM_GLYPHS } from './glyphs';
import type { FieldSourceId } from './field';
import { FIELD_SOURCES } from './field';
import type { LfoShape } from './lfo';
import { LFO_SHAPES, MAX_LFO_DEPTH, MAX_LFO_RATE_HZ, MIN_LFO_DEPTH, MIN_LFO_RATE_HZ } from './lfo';

export type FieldTarget = 'glyph' | 'hue' | 'brightness' | 'jitter';
export const FIELD_TARGETS: readonly FieldTarget[] = ['glyph', 'hue', 'brightness', 'jitter'];

export type LfoTarget =
  | 'none' | 'hueRotate' | 'paletteCycle' | 'glyphSetIndex' | 'fieldScale' | 'fieldOffsetX'
  | 'fieldOffsetY' | 'fieldRotation' | 'trailLength' | 'brightness';

export const LFO_TARGETS: readonly LfoTarget[] = [
  'none', 'hueRotate', 'paletteCycle', 'glyphSetIndex', 'fieldScale', 'fieldOffsetX',
  'fieldOffsetY', 'fieldRotation', 'trailLength', 'brightness',
];

export interface LfoConfig {
  id: string;
  shape: LfoShape;
  rateHz: number;
  depth: number;
  phase: number;
  target: LfoTarget;
}

export interface PaletteStop {
  /** Position along the ramp, [0, 1]. */
  t: number;
  /** Any valid CSS colour string — resolved exclusively through
   *  `@/render/color`'s `resolveCssColor`, never hand-parsed. */
  color: string;
}

export interface ArtColorConfig {
  /** `'lens'` keeps whatever the active `RenderLens`'s own colour is (Art
   *  mode only affects glyph/field/LFO on top of it); `'custom'` draws from
   *  `stops` instead. */
  source: 'lens' | 'custom';
  stops: PaletteStop[];
  hueRotateDeg: number;
  cycleSpeedHz: number;
  trails: { enabled: boolean; decay: number };
}

export interface ArtFieldConfig {
  source: FieldSourceId;
  targets: readonly FieldTarget[];
  scale: number;
  offsetX: number;
  offsetY: number;
  rotationDeg: number;
  seed: number;
  /** Luminance threshold [0, 1] used only by the "seed the world from this
   *  image" one-shot action (`@/render/mediaField.ts`'s `thresholdToBits`). */
  threshold: number;
}

export interface ArtGlyphConfig {
  setId: GlyphSetId;
  customChars: string;
  driver: GlyphDriver;
}

export interface ArtConfig {
  enabled: boolean;
  glyphs: ArtGlyphConfig;
  field: ArtFieldConfig;
  lfos: LfoConfig[];
  color: ArtColorConfig;
}

export const MAX_LFOS = 4;
export const MAX_PALETTE_STOPS = 6;
export const MIN_PALETTE_STOPS = 2;

export function defaultArtConfig(): ArtConfig {
  return {
    enabled: false,
    glyphs: { setId: 'ascii', customChars: DEFAULT_CUSTOM_GLYPHS, driver: 'age' },
    field: {
      source: 'none',
      targets: ['glyph'],
      scale: 1,
      offsetX: 0,
      offsetY: 0,
      rotationDeg: 0,
      seed: 1,
      threshold: 0.5,
    },
    lfos: [],
    color: {
      source: 'lens',
      stops: [
        { t: 0, color: 'oklch(0.55 0.20 260)' },
        { t: 1, color: 'oklch(0.87 0.155 155)' },
      ],
      hueRotateDeg: 0,
      cycleSpeedHz: 0,
      trails: { enabled: false, decay: 0.15 },
    },
  };
}

/** A one-click, zero-configuration "flip the world into ASCII" preset — the
 *  keyboard shortcut and the panel's headline button both apply this. Driven
 *  by `age` (a cell's own honest history), so a fresh universe still reads
 *  meaningfully from the very first generation. */
export function classicAsciiPreset(): ArtConfig {
  const cfg = defaultArtConfig();
  cfg.enabled = true;
  cfg.glyphs = { setId: 'ascii', customChars: DEFAULT_CUSTOM_GLYPHS, driver: 'age' };
  return cfg;
}

export interface ArtPreset {
  id: string;
  label: string;
  description: string;
  build: () => ArtConfig;
}

export const ART_PRESETS: readonly ArtPreset[] = [
  {
    id: 'classic-ascii',
    label: 'Classic ASCII',
    description: 'The plain density ramp, driven by age — a terminal rendering of the living world.',
    build: classicAsciiPreset,
  },
  {
    id: 'ember',
    label: 'Ember',
    description: 'Activity-driven ASCII with a slow warm hue drift and a plasma field nudging brightness.',
    build: () => {
      const cfg = defaultArtConfig();
      cfg.enabled = true;
      cfg.glyphs = { setId: 'ascii', customChars: DEFAULT_CUSTOM_GLYPHS, driver: 'activity' };
      cfg.field = { ...cfg.field, source: 'plasma', targets: ['brightness'], scale: 1, seed: 3 };
      cfg.color = {
        ...cfg.color,
        source: 'custom',
        stops: [
          { t: 0, color: 'oklch(0.35 0.05 30)' },
          { t: 1, color: 'oklch(0.75 0.20 40)' },
        ],
        hueRotateDeg: 0,
      };
      cfg.lfos = [{ id: 'ember-hue', shape: 'sine', rateHz: 0.03, depth: 0.4, phase: 0, target: 'hueRotate' }];
      return cfg;
    },
  },
  {
    id: 'bloom',
    label: 'Bloom',
    description: 'Lineage-hued dots modulated by simplex noise, with palette cycling.',
    build: () => {
      const cfg = defaultArtConfig();
      cfg.enabled = true;
      cfg.glyphs = { setId: 'dots', customChars: DEFAULT_CUSTOM_GLYPHS, driver: 'lineage' };
      cfg.field = { ...cfg.field, source: 'simplex', targets: ['glyph', 'jitter'], scale: 1.4, seed: 7 };
      cfg.color = { ...cfg.color, source: 'lens', cycleSpeedHz: 0.05 };
      cfg.lfos = [{ id: 'bloom-field', shape: 'triangle', rateHz: 0.08, depth: 0.6, phase: 0, target: 'fieldRotation' }];
      return cfg;
    },
  },
  {
    id: 'monolith',
    label: 'Monolith',
    description: 'Box-drawing glyphs by local density, with a faint honest trail of recent history.',
    build: () => {
      const cfg = defaultArtConfig();
      cfg.enabled = true;
      cfg.glyphs = { setId: 'box', customChars: DEFAULT_CUSTOM_GLYPHS, driver: 'density' };
      cfg.color = { ...cfg.color, trails: { enabled: true, decay: 0.08 } };
      return cfg;
    },
  },
];

// ---------------------------------------------------------------------------
// Clamping / sanitising — defends against a corrupted/old localStorage
// payload or a hand-edited imported file without ever throwing. Every field
// is independently clamped/coerced against `defaultArtConfig()`'s shape
// rather than rejecting the whole document, so a partially-valid save still
// loads as much of itself as it can.
// ---------------------------------------------------------------------------

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function sanitizeGlyphs(input: unknown): ArtGlyphConfig {
  const d = defaultArtConfig().glyphs;
  if (typeof input !== 'object' || input === null) return d;
  const o = input as Record<string, unknown>;
  const setId: GlyphSetId = (['ascii', 'blocks', 'box', 'dots', 'geometric', 'custom'] as const)
    .includes(o.setId as GlyphSetId) ? (o.setId as GlyphSetId) : d.setId;
  const customChars = typeof o.customChars === 'string'
    ? o.customChars.slice(0, MAX_CUSTOM_GLYPHS)
    : d.customChars;
  const driver: GlyphDriver = (GLYPH_DRIVERS as readonly string[]).includes(o.driver as string)
    ? (o.driver as GlyphDriver) : d.driver;
  return {
    setId,
    customChars: customChars.length >= MIN_CUSTOM_GLYPHS ? customChars : d.customChars,
    driver,
  };
}

function sanitizeField(input: unknown): ArtFieldConfig {
  const d = defaultArtConfig().field;
  if (typeof input !== 'object' || input === null) return d;
  const o = input as Record<string, unknown>;
  const source: FieldSourceId = (FIELD_SOURCES as readonly string[]).includes(o.source as string)
    ? (o.source as FieldSourceId) : d.source;
  const targets = Array.isArray(o.targets)
    ? o.targets.filter((t): t is FieldTarget => (FIELD_TARGETS as readonly string[]).includes(t as string))
    : d.targets;
  return {
    source,
    targets: targets.length > 0 ? targets : d.targets,
    scale: isFiniteNumber(o.scale) ? clamp(o.scale, 0.05, 20) : d.scale,
    offsetX: isFiniteNumber(o.offsetX) ? clamp(o.offsetX, -1e6, 1e6) : d.offsetX,
    offsetY: isFiniteNumber(o.offsetY) ? clamp(o.offsetY, -1e6, 1e6) : d.offsetY,
    rotationDeg: isFiniteNumber(o.rotationDeg) ? ((o.rotationDeg % 360) + 360) % 360 : d.rotationDeg,
    seed: isFiniteNumber(o.seed) ? o.seed : d.seed,
    threshold: isFiniteNumber(o.threshold) ? clamp(o.threshold, 0, 1) : d.threshold,
  };
}

function sanitizeLfo(input: unknown, fallbackId: string): LfoConfig | null {
  if (typeof input !== 'object' || input === null) return null;
  const o = input as Record<string, unknown>;
  const shape: LfoShape = (LFO_SHAPES as readonly string[]).includes(o.shape as string)
    ? (o.shape as LfoShape) : 'sine';
  const target: LfoTarget = (LFO_TARGETS as readonly string[]).includes(o.target as string)
    ? (o.target as LfoTarget) : 'none';
  return {
    id: typeof o.id === 'string' && o.id ? o.id : fallbackId,
    shape,
    rateHz: isFiniteNumber(o.rateHz) ? clamp(o.rateHz, MIN_LFO_RATE_HZ, MAX_LFO_RATE_HZ) : 0.1,
    depth: isFiniteNumber(o.depth) ? clamp(o.depth, MIN_LFO_DEPTH, MAX_LFO_DEPTH) : 0.5,
    phase: isFiniteNumber(o.phase) ? o.phase : 0,
    target,
  };
}

function sanitizeColor(input: unknown): ArtColorConfig {
  const d = defaultArtConfig().color;
  if (typeof input !== 'object' || input === null) return d;
  const o = input as Record<string, unknown>;
  const source = o.source === 'custom' ? 'custom' : 'lens';
  const stops = Array.isArray(o.stops)
    ? o.stops
      .filter((s): s is PaletteStop => typeof s === 'object' && s !== null
        && isFiniteNumber((s as PaletteStop).t) && typeof (s as PaletteStop).color === 'string')
      .map((s) => ({ t: clamp(s.t, 0, 1), color: s.color }))
      .slice(0, MAX_PALETTE_STOPS)
    : d.stops;
  const trailsObj = typeof o.trails === 'object' && o.trails !== null ? o.trails as Record<string, unknown> : {};
  return {
    source,
    stops: stops.length >= MIN_PALETTE_STOPS ? stops : d.stops,
    hueRotateDeg: isFiniteNumber(o.hueRotateDeg) ? o.hueRotateDeg % 360 : d.hueRotateDeg,
    cycleSpeedHz: isFiniteNumber(o.cycleSpeedHz) ? clamp(o.cycleSpeedHz, 0, 2) : d.cycleSpeedHz,
    trails: {
      enabled: typeof trailsObj.enabled === 'boolean' ? trailsObj.enabled : d.trails.enabled,
      decay: isFiniteNumber(trailsObj.decay) ? clamp(trailsObj.decay, 0.02, 0.8) : d.trails.decay,
    },
  };
}

/** Sanitise an arbitrary (e.g. `JSON.parse`d, possibly corrupt/old/hand-
 *  edited) value into a valid `ArtConfig`, falling back field-by-field to
 *  `defaultArtConfig()` rather than throwing or discarding the whole thing. */
export function sanitizeArtConfig(input: unknown): ArtConfig {
  const d = defaultArtConfig();
  if (typeof input !== 'object' || input === null) return d;
  const o = input as Record<string, unknown>;
  const lfos = Array.isArray(o.lfos)
    ? o.lfos
      .map((l, i) => sanitizeLfo(l, `lfo-${i}`))
      .filter((l): l is LfoConfig => l !== null)
      .slice(0, MAX_LFOS)
    : d.lfos;
  return {
    enabled: typeof o.enabled === 'boolean' ? o.enabled : d.enabled,
    glyphs: sanitizeGlyphs(o.glyphs),
    field: sanitizeField(o.field),
    lfos,
    color: sanitizeColor(o.color),
  };
}

/** True if the config, as configured, needs continuous redraws to animate
 *  (any LFO, colour cycling, trails decaying, or an inherently time-varying
 *  field source). Static configs (e.g. a fixed noise field with no LFOs and
 *  no trails) cost nothing beyond a normal honest-lens redraw — this is what
 *  lets `renderer.ts` keep "static modes stay cheap" true for Art mode too. */
export function isArtConfigAnimated(config: ArtConfig, fieldAnimated: (source: FieldSourceId) => boolean): boolean {
  if (!config.enabled) return false;
  if (config.lfos.length > 0) return true;
  if (config.color.trails.enabled) return true;
  if (config.color.cycleSpeedHz > 0) return true;
  return fieldAnimated(config.field.source);
}

/** Deterministic pseudo-random config for the "Randomise" button — takes an
 *  explicit `seed` (rather than reading `Math.random()` internally) so it
 *  stays a pure, testable function; the store supplies real randomness by
 *  seeding from `Date.now()` at the call site. */
export function randomArtConfig(seed: number): ArtConfig {
  let s = seed >>> 0;
  const next = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
  const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(next() * arr.length) % arr.length]!;

  const cfg = defaultArtConfig();
  cfg.enabled = true;
  cfg.glyphs = {
    setId: pick(['ascii', 'blocks', 'box', 'dots', 'geometric'] as const),
    customChars: DEFAULT_CUSTOM_GLYPHS,
    driver: pick(GLYPH_DRIVERS),
  };
  cfg.field = {
    source: pick(['perlin', 'simplex', 'radial', 'linear', 'plasma'] as const),
    targets: [pick(FIELD_TARGETS), pick(FIELD_TARGETS)].filter((v, i, a) => a.indexOf(v) === i),
    scale: 0.4 + next() * 2.5,
    offsetX: 0,
    offsetY: 0,
    rotationDeg: Math.floor(next() * 360),
    seed: Math.floor(next() * 1000),
    threshold: 0.5,
  };
  const lfoCount = 1 + Math.floor(next() * 2);
  cfg.lfos = Array.from({ length: lfoCount }, (_, i) => ({
    id: `rand-${i}`,
    shape: pick(LFO_SHAPES),
    rateHz: MIN_LFO_RATE_HZ + next() * 0.3,
    depth: 0.2 + next() * 0.6,
    phase: next(),
    target: pick(LFO_TARGETS.filter((t) => t !== 'none')),
  }));
  cfg.color = {
    source: 'custom',
    stops: [
      { t: 0, color: `oklch(0.45 0.18 ${Math.floor(next() * 360)})` },
      { t: 1, color: `oklch(0.82 0.16 ${Math.floor(next() * 360)})` },
    ],
    hueRotateDeg: 0,
    cycleSpeedHz: next() * 0.15,
    trails: { enabled: next() > 0.6, decay: 0.05 + next() * 0.2 },
  };
  return cfg;
}

/** Slow every LFO and disable trails — applied when
 *  `prefers-reduced-motion: reduce` is active, per DESIGN.md § Motion. */
export function applyReducedMotion(config: ArtConfig): ArtConfig {
  return {
    ...config,
    lfos: config.lfos.map((l) => ({ ...l, rateHz: Math.max(MIN_LFO_RATE_HZ, l.rateHz * 0.15) })),
    color: { ...config.color, trails: { ...config.color.trails, enabled: false }, cycleSpeedHz: 0 },
  };
}
