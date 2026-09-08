/**
 * Curated Life-like rule presets, natural-history-plate voice — same spirit
 * as `@/content/specimens.ts`'s corpus, but for RULES rather than patterns.
 * Owned by `core` (this file only; the rest of `@/content/**` is `content`'s).
 *
 * Every `verified` line describes something we ACTUALLY RAN with
 * `@/core/engine` — see `tests/content-rules.test.ts`, which re-runs each
 * claim and asserts the exact figures quoted here. If a claim can't be
 * reproduced there, it doesn't belong in this file (see "Dropped" below).
 *
 * Dropped, and why: Diamoeba (`B35678/S5678`) is famous for organising a
 * dense random soup into stable diamond-shaped blobs, but that behaviour is
 * reportedly sensitive to a narrow initial-density band and a particular
 * seeding shape (not a uniform full-board soup). We tried uniform soups at
 * densities 0.2/0.35/0.45/0.55 on a 128x128 torus: the two lower densities
 * went fully extinct, 0.45 decayed to extinction more slowly, and 0.55
 * exploded to fill literally every cell (16384/16384) — no stable diamond
 * blobs at any density we tried. Rather than ship an unverified headline
 * claim, we're leaving it out. "Anneal"/"Vote" rules were considered but not
 * attempted at all this pass — also left out rather than guessed at.
 */
import type { LifeRule } from '@/core/rule';
import { parseRule } from '@/core/rule';

export interface RulePreset {
  id: string;
  name: string;
  /** Canonical B/S rulestring — see `@/core/rule.ts`. */
  rule: string;
  /** One or two sentences: what this rule mechanically is, natural-history-plate voice. */
  description: string;
  /** The specific, headline claim we verified by actually running the engine — see the module doc and `tests/content-rules.test.ts`. */
  verified: string;
}

export const RULE_PRESETS: readonly RulePreset[] = [
  {
    id: 'conway',
    name: "Conway's Life",
    rule: 'B3/S23',
    description:
      'The original: a dead cell with exactly 3 live neighbours is born, a live cell with 2 or 3 survives. Every curated scene, specimen, and experiment in AFTERLIFE was verified under this rule — see the app\'s non-negotiable defaults.',
    verified:
      'The baseline every other preset is compared against; verified everywhere else in this app (gliders, oscillators, the opening tableau\'s generation-123 encounter, etc).',
  },
  {
    id: 'highlife',
    name: 'HighLife',
    rule: 'B36/S23',
    description:
      "Conway's Life plus one extra spark: a dead cell with exactly 6 live neighbours is also born. That single extra digit is enough to support genuine self-replicators — patterns that produce copies of themselves rather than just moving or oscillating.",
    verified:
      'Seeded with a 5-cell plus-shaped pentomino, HighLife produces 4 exact copies of the original shape by generation 5 (population 5 -> 20) — real self-replication — before the copies collide and the whole pattern collapses to extinction by generation 10. Also verified: a 6-neighbour dead cell is born under this rule where Conway leaves it dead.',
  },
  {
    id: 'day-and-night',
    name: 'Day & Night',
    rule: 'B3678/S34678',
    description:
      'Births and survivals both cluster at high neighbour counts as well as B3 — the rule looks almost the same if you swap every live cell for dead and vice versa, so dense "night" regions behave like sparse "day" regions in reverse.',
    verified:
      'A solid 3x3 block does not freeze (as it would under Conway) or die — it becomes a stable oscillator, its population cycling 9, 9, 5, 5, 9, 9, 5, 5, ... indefinitely.',
  },
  {
    id: 'seeds',
    name: 'Seeds',
    rule: 'B2/S',
    description:
      'No survivals at all — a live cell always dies next generation, births happen at exactly 2 neighbours. Every generation is entirely new cells, which makes this rule chaotic and explosive rather than settled.',
    verified:
      'A single 2x2 block (4 cells) explodes to a population of 128 within 12 generations on a 64x64 torus (4 -> 8 -> 12 -> 16 -> 24 -> 32 -> 52 -> 40 -> 56 -> 72 -> 72 -> 92 -> 128).',
  },
  {
    id: 'maze',
    name: 'Maze',
    rule: 'B3/S12345',
    description:
      'Conway\'s birth rule with a much more permissive survival rule (1 through 5 neighbours). Random soup organises into thin, winding, corridor-like walls rather than dissolving into gliders and oscillators.',
    verified:
      'A 96x96 random soup seeded at density 0.4 settles into a completely static maze of walls: population locks at exactly 5072 cells by around generation 40 and stays exactly 5072 through generation 400.',
  },
  {
    id: 'mazectric',
    name: 'Mazectric',
    rule: 'B3/S1234',
    description:
      'Maze\'s thinner sibling: the same B3 birth rule, but survival tops out at 4 neighbours instead of 5, producing narrower corridors with less cross-connection.',
    verified:
      "The same 96x96, density-0.4 random soup that freezes solid under Maze instead settles into a perfect period-6 population cycle under Mazectric (4591, 4597, 4593, 4597, 4591, 4599, repeating exactly) — visibly thinner and still gently alive, versus Maze's fully frozen 5072-cell structure from an identical starting soup.",
  },
  {
    id: 'replicator',
    name: "Replicator (Fredkin's Parity Rule)",
    rule: 'B1357/S1357',
    description:
      'Birth and survival both fire on every odd neighbour count. This is a parity (XOR) rule: mathematically, EVERY pattern under this rule eventually produces multiple copies of itself, exactly the mechanism behind the "Replicator" family name.',
    verified:
      'A single live cell dies (0 neighbours is even) but every one of its 8 neighbours has exactly 1 live neighbour (odd) and is born — after one generation, a lone cell becomes an exact 8-cell ring around empty space where it used to be.',
  },
  {
    id: 'life-without-death',
    name: 'Life without Death',
    rule: 'B3/S012345678',
    description:
      "Conway's birth rule, but survival at EVERY neighbour count 0 through 8 — once born, a cell never dies. The world only ever accumulates; it's a one-way ratchet, useful for watching how far a spark of growth can spread before it runs out of new places to be born.",
    verified:
      'Seeded with 15% random noise on a 24x24 torus, population never once decreased across 60 generations (checked every single step) — by construction, since every neighbour count survives.',
  },
  {
    id: '2x2',
    name: '2x2',
    rule: 'B36/S125',
    description:
      "Named for its tendency to organise into structures built from 2x2 blocks. Neither Conway's quiet stability nor Seeds' chaos — a middle ground that keeps churning without collapsing or exploding.",
    verified:
      "A 96x96 random soup at density 0.3, run 400 generations, never dies out and never explodes: population stays bounded, ranging between roughly 1700 and 2200 cells during generations 200-400, nowhere near 0 or the board's full 9216-cell capacity.",
  },
  {
    id: 'coral',
    name: 'Coral',
    rule: 'B3/S45678',
    description:
      "Conway's birth rule with a demanding survival threshold (4 or more neighbours) — an isolated or lightly-connected cell dies, but a well-supported one is essentially permanent. Growth accretes slowly at the edges of existing structure, like a reef.",
    verified:
      'A solid 16x16 block grows outward for a few generations (256 -> 524 -> 628 cells) then freezes into an exactly static 612-cell structure by generation ~40, unchanged through generation 200. Seeded instead as a sparse (density 0.4) random soup, most of it dies back hard first — bottoming out around generation 20 at 617 cells, down from 3710 — then steadily re-accretes generation over generation (790 -> 1003 -> ... -> 2902 by generation 100) rather than either freezing or collapsing to zero.',
  },
] as const;

export function getRulePreset(id: string): RulePreset | undefined {
  return RULE_PRESETS.find((p) => p.id === id);
}

/** Find a preset by its rule string (canonical-form comparison, spelling-insensitive), if any preset matches. */
export function findPresetByRule(ruleString: string): RulePreset | undefined {
  let canonical: string;
  try {
    canonical = parseRule(ruleString).rule;
  } catch {
    return undefined;
  }
  return RULE_PRESETS.find((p) => p.rule === canonical);
}

export type { LifeRule };
