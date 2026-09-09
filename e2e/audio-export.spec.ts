import { test, expect } from '@playwright/test';
import { openApp, dismissTitle } from './utils';

/**
 * Verifies the deterministic offline audio render (`@/export/audio/**`)
 * against a REAL `OfflineAudioContext` — unavailable in jsdom/Vitest, which
 * is exactly why this had to be a Playwright spec (see
 * INTEGRATION-NOTES.md's media-export entry for why audio export was cut
 * from an earlier pass rather than shipped unverified).
 *
 * Builds a small, controlled fixture directly in the page (empty world,
 * then a burst of isolated cells guaranteed to die next step, then silence
 * again — the same construction `tests/export-audioPlan.test.ts` uses at
 * the pure-logic level) so this test's expectations don't depend on
 * whatever the live opening scene happens to be doing.
 */

interface AudioCheckResult {
  sampleRate: number;
  durationSeconds: number;
  rmsBeforeBurst: number;
  rmsAfterBurst: number;
  maxSampleDiff: number;
  errorMsg: string | null;
}

test.describe('Audio export vs. a real OfflineAudioContext', () => {
  test('is silent while nothing is happening, audible after an activity burst, and deterministic (inaudibly close) across two renders', async ({ page }) => {
    await openApp(page);
    await dismissTitle(page);

    const result = await page.evaluate(async () => {
      const { createEngine } = await import('/src/core/engine.ts');
      const { createTimelineStore } = await import('/src/core/history.ts');
      const { DEFAULT_AUDIO_SETTINGS } = await import('/src/audio/settings.ts');
      const { renderOfflineAudio } = await import('/src/export/audio/offlineRender.ts');

      const SIZE = 64;
      function stepPlain(history: ReturnType<typeof createTimelineStore>, n: number): void {
        const { engine } = history;
        for (let i = 0; i < n; i++) { engine.step(); history.advance(engine.gen); }
      }
      function buildHistory(beforeGens: number, afterGens: number) {
        const engine = createEngine({ width: SIZE, height: SIZE });
        const history = createTimelineStore({ engine });
        stepPlain(history, beforeGens);
        const cells: Array<{ x: number; y: number; alive: boolean }> = [];
        for (let i = 0; i < 40; i++) cells.push({ x: (i % 8) * 6 + 1, y: Math.floor(i / 8) * 6 + 1, alive: true });
        for (const c of cells) engine.set(c.x, c.y, c.alive);
        history.record(engine.gen, [{ kind: 'set', cells }]);
        stepPlain(history, afterGens);
        return history;
      }

      const beforeGens = 10;
      const afterGens = 60;
      const gensPerSecond = 2;
      const toGen = beforeGens + afterGens;

      function rms(data: Float32Array, fromSec: number, toSec: number, sampleRate: number): number {
        const from = Math.floor(fromSec * sampleRate);
        const to = Math.min(data.length, Math.floor(toSec * sampleRate));
        let sum = 0;
        let n = 0;
        for (let i = from; i < to; i++) { sum += data[i]! * data[i]!; n++; }
        return n > 0 ? Math.sqrt(sum / n) : 0;
      }

      let errorMsg: string | null = null;
      let sampleRate = 0;
      let durationSeconds = 0;
      let rmsBeforeBurst = -1;
      let rmsAfterBurst = -1;

      try {
        const historyA = buildHistory(beforeGens, afterGens);
        const resultA = await renderOfflineAudio({
          history: historyA, fromGen: 0, toGen, gensPerSecond, settings: DEFAULT_AUDIO_SETTINGS,
        });
        sampleRate = resultA.buffer.sampleRate;
        durationSeconds = resultA.buffer.duration;
        const dataA = resultA.buffer.getChannelData(0);

        // Silence strictly before the burst's earliest possible audible
        // bucket (t = beforeGens/gensPerSecond = 5.0s); active window well
        // after it.
        rmsBeforeBurst = rms(dataA, 0.5, 4.5, sampleRate);
        rmsAfterBurst = rms(dataA, 5.5, 6.5, sampleRate);

        // Determinism: an independently built (but structurally identical)
        // history, rendered again, must produce the SAME schedule and
        // essentially the same samples. Empirically (measured while writing
        // this test, with the page's own live Soundscape AudioContext also
        // present — dismissing the title plate creates one via a real user
        // gesture, see `App.tsx`'s `onPointerDown`): Chromium's audio engine
        // is deterministic in isolation (bit-exact with no other
        // AudioContext on the page) but introduces ~1e-7-magnitude
        // floating-point rounding jitter in a long-running oscillator's
        // phase when another context shares its audio thread — over 100dB
        // below full scale, i.e. inaudible and almost always below the
        // 16-bit quantisation step `encodeWav` writes (measured: >99.99% of
        // encoded WAV bytes identical between two renders; the few that
        // differ are off by one quantisation step). That is a real
        // engine-level floating-point characteristic, not a flaw in this
        // module's deterministic SCHEDULING (proven bit-for-bit reproducible
        // in `tests/export-audioPlan.test.ts`, which never touches an
        // AudioContext at all) — so this asserts a tolerance far tighter
        // than anything perceptible or even representable in the shipped
        // 16-bit WAV, not "close enough to sound the same."
        const historyB = buildHistory(beforeGens, afterGens);
        const resultB = await renderOfflineAudio({
          history: historyB, fromGen: 0, toGen, gensPerSecond, settings: DEFAULT_AUDIO_SETTINGS,
        });
        const dataB = resultB.buffer.getChannelData(0);
        let maxDiff = 0;
        if (dataA.length === dataB.length) {
          for (let i = 0; i < dataA.length; i++) {
            const d = Math.abs(dataA[i]! - dataB[i]!);
            if (d > maxDiff) maxDiff = d;
          }
        } else {
          maxDiff = Infinity;
        }
        return { sampleRate, durationSeconds, rmsBeforeBurst, rmsAfterBurst, maxSampleDiff: maxDiff, errorMsg };
      } catch (e) {
        errorMsg = String(e) + (e instanceof Error ? `\n${e.stack}` : '');
        return { sampleRate, durationSeconds, rmsBeforeBurst, rmsAfterBurst, maxSampleDiff: -1, errorMsg };
      }
    });

    const r = result as AudioCheckResult;
    expect(r.errorMsg).toBeNull();
    expect(r.sampleRate).toBeGreaterThan(0);
    expect(r.durationSeconds).toBeCloseTo(35, 0); // (10 + 60) / 2
    expect(r.rmsBeforeBurst).toBe(0); // genuinely silent, not just quiet
    expect(r.rmsAfterBurst).toBeGreaterThan(0.001); // genuinely audible
    // Tighter than 16-bit quantisation (~3e-5) and ~100x tighter than the
    // measured worst case (~1.7e-7) — see the comment above for why this
    // isn't bit-exact equality.
    expect(r.maxSampleDiff).toBeLessThan(1e-5);
  });

  test('audio-only WAV export is reachable and produces a real file for the live session', async ({ page }) => {
    await openApp(page);
    await dismissTitle(page);
    await page.waitForTimeout(300);

    const result = await page.evaluate(async () => {
      const mod = await import('/src/export/index.ts');
      const session = (window as unknown as { __AFTERLIFE__?: { history: { windowStart: number; maxGen: number } } }).__AFTERLIFE__;
      if (!session) return { ok: false, size: 0 };
      const toGen = session.history.maxGen;
      const fromGen = Math.max(session.history.windowStart, toGen - 10);
      const handle = mod.exportWorldAudio({ fromGen, toGen, gensPerSecond: 10 });
      const out = await handle.promise;
      return { ok: true, size: out.blob.size, type: out.blob.type, filename: out.filename };
    });

    expect(result.ok).toBe(true);
    expect(result.size).toBeGreaterThan(44); // more than just a WAV header
    expect(result.type).toBe('audio/wav');
    expect(result.filename).toMatch(/\.wav$/);
  });
});
