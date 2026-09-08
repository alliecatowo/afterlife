/**
 * Life-like rule model: generalises the engine beyond Conway's B3/S23 to any
 * outer-totalistic B/S ("birth/survive") rule on the 8-cell Moore
 * neighbourhood. Owned by `core`.
 *
 * A B/S rule is exactly two sets of neighbour counts (0..8):
 *  - `birth`: a dead cell with a live-neighbour count in this set is born.
 *  - `survive`: a live cell with a live-neighbour count in this set survives.
 * Everything else dies (or stays dead). This is the same family Conway's
 * Life, HighLife, Seeds, Day & Night, etc. all belong to — see
 * `@/content/rules.ts` for the curated, VERIFIED preset list.
 *
 * Deliberately NOT supported (see `parseRule`'s errors, which name what was
 * found rather than failing silently):
 *  - Generations rules (`B.../S.../C<n>`, 3+ states) — a fundamentally
 *    different, N-state automaton; our engine (and `Snapshot`, frozen in
 *    `@/core/types.ts`) is binary alive/dead only.
 *  - Non-totalistic "Hensel" notation (`B2n3/S23-a4i`, per-neighbour-position
 *    conditions) — a materially different rule model, not just a wider digit
 *    set.
 *  - Non-Moore / larger neighbourhoods (Larger-than-Life `R2,C0,...`, von
 *    Neumann, hexagonal) — the engine's step kernel is hardwired to the
 *    8-cell Moore neighbourhood for speed (see `engine.ts`'s `step()`).
 *
 * Performance
 * -----------
 * `LifeRule.table` is an 18-entry `Uint8Array`, index `was * 9 + n` (was:
 * 0/1, n: live-neighbour count 0..8) -> next state. `engine.ts`'s generic
 * step kernel indexes this directly — no per-cell function call, no `Set`
 * lookup, no branch on rule identity inside the hot loop. Conway's own
 * B3/S23 keeps a SEPARATE hand-unrolled fast path in `engine.ts` (the
 * `n === 3 || (n === 2 && was === 1)` expression already there) — `isConway`
 * is what lets the engine pick it. See ARCHITECTURE.md and
 * INTEGRATION-NOTES.md for the measured before/after.
 */

/** Thrown by `parseRule` for a malformed or genuinely unsupported rule string. */
export class RuleParseError extends Error {
  constructor(
    public readonly rawRule: string,
    public readonly reason: string,
  ) {
    super(`Unsupported or invalid rule "${rawRule}": ${reason}`);
    this.name = 'RuleParseError';
  }
}

/** Conway's Life, the app's default and only non-negotiable rule for curated content. */
export const CONWAY_RULE_STRING = 'B3/S23';

/** A parsed, canonicalised B/S Life-like rule with its precomputed lookup table. */
export interface LifeRule {
  /** Canonical `B<digits>/S<digits>` string — ascending, deduplicated digits, always this exact form regardless of input spelling/order. */
  readonly rule: string;
  /** Birth neighbour counts (0..8), ascending, deduplicated. */
  readonly birth: readonly number[];
  /** Survive neighbour counts (0..8), ascending, deduplicated. */
  readonly survive: readonly number[];
  /** True iff this is exactly Conway's Life (birth [3], survive [2,3]) — lets the engine pick its specialised fast path. */
  readonly isConway: boolean;
  /** 18-entry lookup table: `table[was * 9 + n]` is the next state (0/1). Never mutated after construction. */
  readonly table: Uint8Array;
}

function buildTable(birth: readonly number[], survive: readonly number[]): Uint8Array {
  const table = new Uint8Array(18);
  const birthSet = new Set(birth);
  const surviveSet = new Set(survive);
  for (let n = 0; n <= 8; n++) {
    table[0 * 9 + n] = birthSet.has(n) ? 1 : 0;
    table[1 * 9 + n] = surviveSet.has(n) ? 1 : 0;
  }
  return table;
}

function canonicalDigits(nums: readonly number[]): string {
  return [...new Set(nums)].sort((a, b) => a - b).join('');
}

/** Build a `LifeRule` from already-validated digit arrays. Internal — use `parseRule` for untrusted input. */
export function makeRule(birth: readonly number[], survive: readonly number[]): LifeRule {
  const b = [...new Set(birth)].sort((a, b2) => a - b2);
  const s = [...new Set(survive)].sort((a, b2) => a - b2);
  const rule = `B${b.join('')}/S${s.join('')}`;
  const isConway = canonicalDigits(b) === '3' && canonicalDigits(s) === '23';
  return { rule, birth: b, survive: s, isConway, table: buildTable(b, s) };
}

/** The default engine rule (Conway's Life), computed once. */
export const CONWAY_RULE: LifeRule = makeRule([3], [2, 3]);

function parseDigitGroup(group: string, raw: string, which: 'B' | 'S'): number[] {
  if (group.length === 0) return [];
  const out: number[] = [];
  for (const ch of group) {
    if (!/[0-9]/.test(ch)) {
      throw new RuleParseError(raw, `the ${which} group "${group}" contains a non-digit character ("${ch}")`);
    }
    const d = Number(ch);
    if (d > 8) {
      throw new RuleParseError(
        raw,
        `found neighbour count ${d} in the ${which} group — only 0..8 (the 8-cell Moore neighbourhood) is supported`,
      );
    }
    out.push(d);
  }
  return out;
}

/**
 * Parse a B/S rulestring, tolerant of the common real-world variants:
 * `B3/S23`, `b3/s23` (case-insensitive), `S23/B3` (either order), and the
 * historic Life 1.05 `23/3` (survive/birth, no letters). Whitespace around
 * the whole string is trimmed. Throws `RuleParseError` with a message naming
 * exactly what was found for anything genuinely unsupported (Generations,
 * Hensel/non-totalistic, non-Moore neighbourhoods) or structurally invalid.
 */
export function parseRule(raw: string): LifeRule {
  const s = raw.trim();
  if (s.length === 0) throw new RuleParseError(raw, 'empty rule string');

  // Larger-than-Life / range-neighbourhood headers look like "R2,C0,S6..12,B7..12,NM"
  // or similar comma-separated forms — never a plain B/S string.
  if (/,/.test(s) || /^R\d/i.test(s)) {
    throw new RuleParseError(
      raw,
      'found a Larger-than-Life/range-neighbourhood specifier (comma-separated fields, or a leading "R<n>" radius) — only the standard 8-cell Moore neighbourhood B/S format is supported',
    );
  }

  // Generations rules carry a third slash-separated segment for the state
  // count, e.g. "B3/S23/3" or "3457/357/8" — reject before anything else so
  // the error names the real shape of the input, not a confusing digit error.
  const slashCount = (s.match(/\//g) ?? []).length;
  if (slashCount >= 2) {
    const segments = s.split('/').length;
    throw new RuleParseError(
      raw,
      `found ${segments} slash-separated segments — this looks like a Generations rule (B.../S.../C<n>), which needs more than 2 cell states and isn't supported (this engine is binary alive/dead only)`,
    );
  }

  let birthRaw: string;
  let surviveRaw: string;

  let m = /^B([0-9a-z-]*)\/S([0-9a-z-]*)$/i.exec(s);
  if (m) {
    birthRaw = m[1]!;
    surviveRaw = m[2]!;
  } else if ((m = /^S([0-9a-z-]*)\/B([0-9a-z-]*)$/i.exec(s))) {
    surviveRaw = m[1]!;
    birthRaw = m[2]!;
  } else if ((m = /^([0-9]*)\/([0-9]*)$/.exec(s))) {
    // Historic Life 1.05 notation: "{survive}/{birth}", no letters.
    surviveRaw = m[1]!;
    birthRaw = m[2]!;
  } else {
    throw new RuleParseError(raw, 'not a recognised B/S rulestring (expected e.g. "B3/S23")');
  }

  if (/[a-z-]/i.test(birthRaw) || /[a-z-]/i.test(surviveRaw)) {
    const sample = /[a-z-]/i.test(birthRaw) ? birthRaw : surviveRaw;
    throw new RuleParseError(
      raw,
      `found Hensel (non-totalistic) neighbourhood notation ("${sample}") — only fully isotropic, plain-digit B/S rules are supported`,
    );
  }

  const birth = parseDigitGroup(birthRaw, raw, 'B');
  const survive = parseDigitGroup(surviveRaw, raw, 'S');
  return makeRule(birth, survive);
}

/** True iff `raw` parses to a supported Life-like rule. Never throws. */
export function isValidRuleString(raw: string): boolean {
  try {
    parseRule(raw);
    return true;
  } catch {
    return false;
  }
}

/** Canonical string form (see `LifeRule.rule`) — parses then re-serialises, so messy input normalises. */
export function serializeRule(rule: LifeRule): string {
  return rule.rule;
}

/** True iff two rule strings denote the same rule (order/case/duplicate-digit insensitive). Throws if either fails to parse. */
export function ruleStringsEqual(a: string, b: string): boolean {
  return parseRule(a).rule === parseRule(b).rule;
}
