/**
 * A naturalist's logbook, not a gamified points layer — an extension of
 * `@/content/discoveries`'s "growth through observation" model rather than a
 * second visual language. Every entry here names something a visitor
 * genuinely DID or WITNESSED in a real simulation (a specimen recognised, a
 * generation reached, an extinction observed), never a fabricated milestone
 * and never something merely opening a panel would satisfy. Unearned entries
 * stay visible with an honest, non-cryptic description of what would earn
 * them — "something to aim at," per the design brief, not a locked riddle.
 *
 * Pure, serialisable data and pure functions only — no DOM, no bus, no
 * dependency on `@/ui` or `@/persist`, exactly like `@/content/discoveries`.
 * `@/ui/achievements/store.ts` is the impure bridge that watches real bus
 * events/session state and calls `unlock`-shaped updates against this
 * module's shapes; `@/persist` is expected to serialise `AchievementLog`
 * state directly, the same convention `@/content/discoveries` documents for
 * its own log.
 */
import type { Generation, Rect } from '@/core/types';

/** How many generations a world must run without its population reaching
 *  zero to count as "kept alive" — see `AchievementId: 'survived'`. */
export const SURVIVAL_GENERATIONS = 500;
/** How many distinct specimens (named or merely characterized) must be
 *  catalogued to count as a naturalist's collection. */
export const CATALOGUE_SIZE = 5;
/** How many times the SAME traveler must be re-observed (see
 *  `@/content/discoveries`'s `observationCount`) before it starts to feel
 *  like "your traveler," per the design brief. */
export const TRAVELLER_OBSERVATIONS = 10;

export type AchievementId =
  | 'first-glider'
  | 'first-oscillator'
  | 'first-gun'
  | 'scrub-backward'
  | 'first-fork'
  | 'first-sculpture'
  | 'survived'
  | 'extinction-witnessed'
  | 'collision-witnessed'
  | 'experiment-first-contact'
  | 'experiment-one-cell'
  | 'experiment-keep-alive'
  | 'catalogue'
  | 'your-traveller';

export interface AchievementDef {
  id: AchievementId;
  /** Short, natural-history-plate title — no exclamation marks, no emoji. */
  title: string;
  /** One or two sentences, honest whether earned or not — describes the
   *  real, observable thing that earns it. */
  description: string;
}

export const ACHIEVEMENTS: readonly AchievementDef[] = [
  {
    id: 'first-glider',
    title: 'A traveler, recognized',
    description: 'A glider was identified in the field — the smallest spaceship, gliding one cell diagonally every four generations.',
  },
  {
    id: 'first-oscillator',
    title: 'A steady pulse',
    description: 'An oscillator was identified — a structure that returns to its own shape after a fixed number of generations, forever, undisturbed.',
  },
  {
    id: 'first-gun',
    title: 'A source, not a traveler',
    description: 'A glider gun was identified — a structure that manufactures a new traveler on a fixed schedule, without ever moving itself.',
  },
  {
    id: 'scrub-backward',
    title: 'Looking back',
    description: 'The history ribbon was dragged backward — the past of this world is recorded, not gone, and was visited on purpose for the first time.',
  },
  {
    id: 'first-fork',
    title: 'A second future',
    description: 'A cell was changed at a generation already lived through — the original future was kept, and a new branch grew from that moment instead.',
  },
  {
    id: 'first-sculpture',
    title: 'Time, held in the hand',
    description: 'The Time Sculpture was opened on a selected region — its recorded history lifted into a shape that can be walked around.',
  },
  {
    id: 'survived',
    title: 'Kept alive',
    description: `A world was kept running for ${SURVIVAL_GENERATIONS} consecutive generations without its population ever reaching zero.`,
  },
  {
    id: 'extinction-witnessed',
    title: 'An ending, observed',
    description: "A world's population reached zero — every living cell died out in the same generation, and nothing was left to continue it.",
  },
  {
    id: 'collision-witnessed',
    title: 'A meeting, not survived',
    description: 'A traveler being followed met something it did not survive — its trail ends where two structures interacted and neither continued as it was.',
  },
  {
    id: 'experiment-first-contact',
    title: 'First Contact, answered',
    description: 'The "First Contact" experiment was completed — an intervention that changed the outcome of a scripted encounter.',
  },
  {
    id: 'experiment-one-cell',
    title: 'One Cell, answered',
    description: 'The "One Cell" experiment was completed — two otherwise-identical worlds, one cell apart, were shown to diverge.',
  },
  {
    id: 'experiment-keep-alive',
    title: 'Keep Something Alive, answered',
    description: 'The "Keep Something Alive" experiment was completed — a world was kept from going quiet for its full measured run.',
  },
  {
    id: 'catalogue',
    title: "A naturalist's collection",
    description: `${CATALOGUE_SIZE} distinct specimens were catalogued in the Field Guide — different structures, not repeat sightings of the same one.`,
  },
  {
    id: 'your-traveller',
    title: 'Your traveler',
    description: `The same traveler was re-observed ${TRAVELLER_OBSERVATIONS} times — tracked long enough across this world that it stops being just a glider.`,
  },
];

export function getAchievement(id: AchievementId): AchievementDef | undefined {
  return ACHIEVEMENTS.find((a) => a.id === id);
}

/** A single earned entry — real state at the moment it was earned, never
 *  faked or backfilled. Mirrors `@/content/discoveries`'s own "generation
 *  and timestamp it was earned" shape. */
export interface EarnedAchievement {
  id: AchievementId;
  /** The generation this was true at. */
  gen: Generation;
  /** Wall-clock time it was earned, `Date.now()` — shown alongside `gen`
   *  since a generation count alone doesn't say when in real time it happened. */
  at: number;
  /** Where to return to, for achievements tied to a specific place in the
   *  world (a specimen, an extinction, a collision) — `undefined` for ones
   *  that aren't about a place (an experiment, a branch fork by count alone). */
  rect?: Rect;
}

export type AchievementLog = Partial<Record<AchievementId, EarnedAchievement>>;

/** Whether `v` is a well-formed `EarnedAchievement` for a KNOWN id — used to
 *  validate whatever was read back from storage, the same defensive
 *  posture `@/persist/localStorage`'s own index/document decoding uses:
 *  corrupt or future/unknown data degrades to "ignore this entry", never a throw. */
function isValidEntry(id: string, v: unknown): v is EarnedAchievement {
  if (!ACHIEVEMENTS.some((a) => a.id === id)) return false;
  if (typeof v !== 'object' || v === null) return false;
  const e = v as Partial<EarnedAchievement>;
  return (
    e.id === id &&
    typeof e.gen === 'number' &&
    typeof e.at === 'number' &&
    (e.rect === undefined || (typeof e.rect === 'object' && e.rect !== null))
  );
}

/** Parses a persisted logbook, dropping anything corrupt or naming an
 *  unknown id (a future achievement added after this profile's last visit,
 *  or a hand-edited storage entry) rather than throwing. */
export function parseAchievementLog(raw: unknown): AchievementLog {
  const log: AchievementLog = {};
  if (typeof raw !== 'object' || raw === null) return log;
  for (const [id, entry] of Object.entries(raw as Record<string, unknown>)) {
    if (isValidEntry(id, entry)) log[id as AchievementId] = entry;
  }
  return log;
}

/** Every defined achievement, earned ones carrying their real entry —
 *  exactly the shape a quiet logbook panel wants to render (earned entries
 *  first-class, unearned ones present but muted), without the panel needing
 *  to know how to reconcile `ACHIEVEMENTS` against a sparse earned map itself. */
export interface LogbookRow {
  def: AchievementDef;
  earned: EarnedAchievement | null;
}

export function logbookRows(log: AchievementLog): LogbookRow[] {
  return ACHIEVEMENTS.map((def) => ({ def, earned: log[def.id] ?? null }));
}
