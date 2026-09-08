import { describe, expect, it } from 'vitest';
import {
  ACHIEVEMENTS, CATALOGUE_SIZE, SURVIVAL_GENERATIONS, TRAVELLER_OBSERVATIONS,
  logbookRows, parseAchievementLog, type AchievementLog, type AchievementId,
} from '@/content/achievements';

function findAchievement(id: AchievementId) {
  return ACHIEVEMENTS.find((a) => a.id === id);
}

describe('content/achievements: static definitions', () => {
  it('every achievement has a unique id, a non-empty title, and an honest (non-empty) description even unearned', () => {
    const ids = new Set(ACHIEVEMENTS.map((a) => a.id));
    expect(ids.size).toBe(ACHIEVEMENTS.length);
    for (const a of ACHIEVEMENTS) {
      expect(a.title.length).toBeGreaterThan(0);
      expect(a.description.length).toBeGreaterThan(0);
      // The natural-history voice bans exclamation marks and emoji — a
      // cheap, durable regression guard against the feature drifting into
      // a gamified points layer.
      expect(a.description).not.toMatch(/!/);
      expect(a.title).not.toMatch(/!/);
    }
  });

  it('finds a known id and is undefined for an unknown one', () => {
    expect(findAchievement('first-glider')?.title).toBeTruthy();
    expect(findAchievement('not-a-real-id' as AchievementId)).toBeUndefined();
  });

  it('thresholds referenced in copy are exported, not hardcoded twice', () => {
    expect(SURVIVAL_GENERATIONS).toBeGreaterThan(0);
    expect(CATALOGUE_SIZE).toBeGreaterThan(1);
    expect(TRAVELLER_OBSERVATIONS).toBeGreaterThan(1);
    expect(findAchievement('survived')!.description).toContain(String(SURVIVAL_GENERATIONS));
    expect(findAchievement('catalogue')!.description).toContain(String(CATALOGUE_SIZE));
    expect(findAchievement('your-traveller')!.description).toContain(String(TRAVELLER_OBSERVATIONS));
  });
});

describe('content/achievements: parseAchievementLog', () => {
  it('round-trips a well-formed log unchanged', () => {
    const log: AchievementLog = { 'first-glider': { id: 'first-glider', gen: 40, at: 12345 } };
    expect(parseAchievementLog(JSON.parse(JSON.stringify(log)))).toEqual(log);
  });

  it('keeps a rect reference when present', () => {
    const log: AchievementLog = {
      'first-sculpture': { id: 'first-sculpture', gen: 10, at: 1, rect: { x: 1, y: 2, w: 3, h: 4 } },
    };
    expect(parseAchievementLog(JSON.parse(JSON.stringify(log)))).toEqual(log);
  });

  it('drops an entry naming an unknown id (a future achievement, or hand-edited storage) instead of throwing', () => {
    const raw = { 'first-glider': { id: 'first-glider', gen: 1, at: 1 }, 'some-future-id': { id: 'some-future-id', gen: 1, at: 1 } };
    const log = parseAchievementLog(raw);
    expect(Object.keys(log)).toEqual(['first-glider']);
  });

  it('drops a structurally invalid entry for a known id', () => {
    expect(parseAchievementLog({ 'first-glider': { id: 'first-glider', gen: 'not a number', at: 1 } })).toEqual({});
    expect(parseAchievementLog({ 'first-glider': null })).toEqual({});
  });

  it('degrades to an empty log for non-object input rather than throwing', () => {
    expect(parseAchievementLog(null)).toEqual({});
    expect(parseAchievementLog('nope')).toEqual({});
    expect(parseAchievementLog(42)).toEqual({});
  });
});

describe('content/achievements: logbookRows', () => {
  it('includes every defined achievement, earned ones carrying their entry, unearned ones null', () => {
    const log: AchievementLog = { 'first-glider': { id: 'first-glider', gen: 5, at: 1 } };
    const rows = logbookRows(log);
    expect(rows).toHaveLength(ACHIEVEMENTS.length);
    const glider = rows.find((r) => r.def.id === 'first-glider')!;
    expect(glider.earned).toEqual(log['first-glider']);
    const others = rows.filter((r) => r.def.id !== 'first-glider');
    expect(others.every((r) => r.earned === null)).toBe(true);
  });

  it('an empty log yields every row unearned', () => {
    const rows = logbookRows({});
    expect(rows.every((r) => r.earned === null)).toBe(true);
  });
});
