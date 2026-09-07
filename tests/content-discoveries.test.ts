import { describe, expect, it } from 'vitest';
import { createEngine } from '@/core/engine';
import { scan } from '@/content/recognition';
import { SPECIMENS, toStampPattern } from '@/content/specimens';
import { bookmark, isSameDiscovery, reobserve, toFieldGuideEntry } from '@/content/discoveries';

const GLIDER = SPECIMENS.find((s) => s.name === 'glider')!;

/** Scans the glider's current tight neighbourhood and returns its cluster (there is exactly one). */
function scanGlider(engineWidth: number, engineHeight: number, engine: ReturnType<typeof createEngine>) {
  const result = scan(engine, { x: 0, y: 0, w: engineWidth, h: engineHeight });
  const hit = result.clusters.find((c) => c.status === 'named' && c.name === 'glider');
  if (!hit) throw new Error('expected a named glider cluster');
  return hit;
}

describe('content/discoveries: continuity-based dedup', () => {
  it('recognises a glider several generations later, translated along its own trajectory, as the SAME discovery', () => {
    const engine = createEngine({ width: 60, height: 60 });
    engine.stamp(toStampPattern(GLIDER), 10, 10, { rotate: 0, flipX: false, flipY: false });

    const first = scanGlider(60, 60, engine);
    const d = bookmark(first, engine.gen);
    expect(d.observationCount).toBe(1);

    // A glider's period is 4 generations, translating (1,1) each period.
    // Step forward several periods — the equivalent of the ambient scanner's
    // ~2.2s tick catching the same traveler further along.
    for (let i = 0; i < 12; i++) engine.step();

    const later = scanGlider(60, 60, engine);
    expect(isSameDiscovery(d, later, engine.gen)).toBe(true);

    const strengthened = reobserve(d, engine.gen, later);
    expect(strengthened.observationCount).toBe(2);
    expect(strengthened.lastSeenGen).toBe(engine.gen);
    // Re-observation strengthens the existing entry — same id, no new one.
    expect(strengthened.id).toBe(d.id);
  });

  it('does NOT merge two independent gliders far apart into one discovery', () => {
    const engine = createEngine({ width: 200, height: 200 });
    engine.stamp(toStampPattern(GLIDER), 10, 10, { rotate: 0, flipX: false, flipY: false });
    engine.stamp(toStampPattern(GLIDER), 150, 150, { rotate: 0, flipX: false, flipY: false });

    const result = scan(engine, { x: 0, y: 0, w: 200, h: 200 });
    const gliders = result.clusters.filter((c) => c.status === 'named' && c.name === 'glider');
    expect(gliders.length).toBe(2);

    const d = bookmark(gliders[0]!, engine.gen);
    // The second, distant glider must not read as a re-observation of the first.
    expect(isSameDiscovery(d, gliders[1]!, engine.gen)).toBe(false);
  });

  it('does not match a differently-named structure even at the same position', () => {
    const engine = createEngine({ width: 40, height: 40 });
    const block = SPECIMENS.find((s) => s.name === 'block')!;
    engine.stamp(toStampPattern(block), 15, 15, { rotate: 0, flipX: false, flipY: false });
    const result = scan(engine, { x: 0, y: 0, w: 40, h: 40 });
    const blockCluster = result.clusters.find((c) => c.name === 'block')!;

    const glider = SPECIMENS.find((s) => s.name === 'glider')!;
    const engine2 = createEngine({ width: 40, height: 40 });
    engine2.stamp(toStampPattern(glider), 15, 15, { rotate: 0, flipX: false, flipY: false });
    const gliderCluster = scan(engine2, { x: 0, y: 0, w: 40, h: 40 }).clusters.find((c) => c.name === 'glider')!;

    const d = bookmark(blockCluster, 0);
    expect(isSameDiscovery(d, gliderCluster, 0)).toBe(false);
  });

  it('reobserve grows the trail only when the structure actually moved', () => {
    const engine = createEngine({ width: 40, height: 40 });
    const block = SPECIMENS.find((s) => s.name === 'block')!;
    engine.stamp(toStampPattern(block), 15, 15, { rotate: 0, flipX: false, flipY: false });
    const cluster = scan(engine, { x: 0, y: 0, w: 40, h: 40 }).clusters.find((c) => c.name === 'block')!;

    let d = bookmark(cluster, 0);
    expect(d.trail).toHaveLength(1);
    // A still life re-scanned at the exact same position refreshes the
    // existing sighting's generation rather than growing the trail forever.
    d = reobserve(d, 10, cluster);
    expect(d.trail).toHaveLength(1);
    expect(d.trail[0]!.gen).toBe(10);
    expect(d.observationCount).toBe(2);
  });

  it('surfaces the observation count in the Field Guide entry once re-observed', () => {
    const engine = createEngine({ width: 60, height: 60 });
    engine.stamp(toStampPattern(GLIDER), 10, 10, { rotate: 0, flipX: false, flipY: false });
    const first = scanGlider(60, 60, engine);
    let d = bookmark(first, engine.gen);
    expect(toFieldGuideEntry(d).body).not.toMatch(/Observed \d+ times/);

    for (let i = 0; i < 4; i++) engine.step();
    const later = scanGlider(60, 60, engine);
    d = reobserve(d, engine.gen, later);
    expect(toFieldGuideEntry(d).body).toMatch(/Observed 2 times so far, most recently at generation \d+\./);
  });
});
