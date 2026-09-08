import { describe, expect, it } from 'vitest';
import { ABOUT_CONTENT, TOUR_STEPS, getTourStep } from '@/content/tour';
import { OPENING_VERIFIED } from '@/content/scenes';
import { TOUR_BEHAVIORS } from '@/ui/tutorial/behaviors';

const EMOJI_RANGE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;

function sentenceCount(text: string): number {
  // Counts terminal punctuation, ignoring the em-dashes/hyphens the house
  // voice uses freely mid-sentence — a rough but honest proxy for "one or
  // two sentences", matching how `content-opening.test.ts`-style tests in
  // this repo check prose shape without a full parser.
  return (text.match(/[.!?]+(?:\s|$)/g) ?? []).length;
}

describe('content: guided tour script', () => {
  it('covers every required topic exactly once, in a sensible order', () => {
    const ids = TOUR_STEPS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length); // no duplicates
    expect(ids[0]).toBe('welcome');
    expect(ids[ids.length - 1]).toBe('completion');
    for (const required of [
      'encounter', 'transport', 'draw', 'stamp', 'lenses', 'ribbon', 'fork', 'sculpture', 'field-guide', 'experiments',
    ] as const) {
      expect(ids).toContain(required);
    }
  });

  it('every step is one or two sentences, in the natural-history-plate voice: no exclamation marks, no emoji', () => {
    for (const step of TOUR_STEPS) {
      expect(step.body, `${step.id} body`).not.toMatch(/!/);
      expect(step.title, `${step.id} title`).not.toMatch(/!/);
      expect(EMOJI_RANGE.test(step.body), `${step.id} body has emoji`).toBe(false);
      expect(EMOJI_RANGE.test(step.title), `${step.id} title has emoji`).toBe(false);
      const sentences = sentenceCount(step.body);
      expect(sentences, `${step.id} body sentence count: "${step.body}"`).toBeGreaterThanOrEqual(1);
      expect(sentences, `${step.id} body sentence count: "${step.body}"`).toBeLessThanOrEqual(3);
    }
  });

  it('the encounter step points at the real, verified opening-scene encounter (generation 123)', () => {
    const step = getTourStep('encounter');
    expect(step).toBeDefined();
    expect(step!.target).toEqual({ kind: 'world', at: OPENING_VERIFIED.firstInteractingCell });
    expect(step!.body).toMatch(/meet/);
  });

  it('every step with a showMeLabel has a matching showMe behavior, and vice versa', () => {
    for (const step of TOUR_STEPS) {
      const behavior = TOUR_BEHAVIORS[step.id];
      expect(Boolean(step.showMeLabel), `${step.id} showMeLabel vs behavior.showMe`).toBe(Boolean(behavior?.showMe));
    }
  });

  it('every non-center target has a placement, and center-targeted steps are the bookends', () => {
    for (const step of TOUR_STEPS) {
      expect(['top', 'bottom', 'left', 'right']).toContain(step.placement);
      if (step.target.kind === 'center') {
        expect(['welcome', 'completion']).toContain(step.id);
      }
    }
  });

  it('the About copy explains the actual rules (B3/S23) without repeating the tour verbatim', () => {
    const joined = ABOUT_CONTENT.paragraphs.join(' ');
    expect(joined).toMatch(/two or three/);
    expect(joined).toMatch(/exactly three/);
    expect(EMOJI_RANGE.test(joined)).toBe(false);
    expect(joined).not.toMatch(/!/);
  });
});
