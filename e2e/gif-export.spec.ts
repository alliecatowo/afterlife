import { test, expect } from '@playwright/test';
import { openApp, dismissTitle, ensurePaused, realGen } from './utils';

/**
 * Verifies the hand-written GIF encoder (`@/export/gif/**`) against
 * Chromium's OWN `ImageDecoder` — a real, independent third-party GIF
 * decoder, not a self-authored round-trip. This is the whole point of
 * running this as a Playwright spec rather than a vitest unit test: jsdom
 * has no image decoder at all, so a unit test could only check this
 * project's OWN encoder against its OWN decoder, which is exactly the
 * unverifiable situation that got GIF export cut from an earlier pass (see
 * INTEGRATION-NOTES.md's media-export entry).
 *
 * Calls `exportWorldGif` directly (dynamic import of the real module the
 * app's `ExportPanel.tsx` also calls) against the live session's real
 * history — not a synthetic fixture — so this exercises the exact code path
 * a user hitting "Export" in the dialog runs, including the deterministic
 * replay/frame-source pipeline.
 */

interface GifCheckResult {
  frameCount: number;
  width: number;
  height: number;
  repetitionCount: number | string;
  decodedFrameCount: number;
  distinctFrameContentCount: number;
  headerOk: boolean;
  trailerOk: boolean;
  errorMsg: string | null;
}

test.describe('GIF export vs. Chromium\'s real ImageDecoder', () => {
  test('produces a GIF Chromium decodes correctly: right frame count, dimensions, looping, and genuinely varying pixel content', async ({ page }) => {
    await openApp(page);
    await dismissTitle(page);
    await ensurePaused(page);
    // Let the world advance a little under manual stepping isn't necessary —
    // the opening scene is already live; just make sure there's a real,
    // non-trivial generation range to export.
    await page.waitForTimeout(300);
    const gen = await realGen(page);
    expect(gen).toBeGreaterThan(0);

    const result = await page.evaluate(async (toGen) => {
      const mod = await import('/src/export/index.ts');
      const fromGen = Math.max(0, toGen - 20);
      const handle = mod.exportWorldGif({
        fromGen,
        toGen,
        width: 160,
        height: 100,
        fps: 8,
        gensPerSecond: 16,
        annotate: false,
      });
      const out = await handle.promise;
      const buf = await out.blob.arrayBuffer();
      const bytes = new Uint8Array(buf);

      const headerOk = String.fromCharCode(...bytes.slice(0, 6)) === 'GIF89a';
      const trailerOk = bytes[bytes.length - 1] === 0x3b;

      let errorMsg: string | null = null;
      let frameCount = 0;
      let width = 0;
      let height = 0;
      let repetitionCount: number | string = 'unknown';
      let decodedFrameCount = 0;
      const frameHashes = new Set<string>();

      try {
        const decoder = new ImageDecoder({ data: buf, type: 'image/gif' });
        await decoder.tracks.ready;
        const track = decoder.tracks.selectedTrack!;
        frameCount = track.frameCount;
        repetitionCount = track.repetitionCount === Infinity ? 'infinite' : track.repetitionCount;

        const canvas = new OffscreenCanvas(1, 1);
        const ctx = canvas.getContext('2d')!;
        for (let i = 0; i < frameCount; i++) {
          const { image } = await decoder.decode({ frameIndex: i });
          width = image.displayWidth;
          height = image.displayHeight;
          canvas.width = width;
          canvas.height = height;
          ctx.drawImage(image, 0, 0);
          const data = ctx.getImageData(0, 0, width, height).data;
          // Cheap content fingerprint: sum of every 37th byte — enough to
          // tell "genuinely different frame" from "accidentally identical."
          let sum = 0;
          for (let b = 0; b < data.length; b += 37) sum += data[b]!;
          frameHashes.add(String(sum));
          decodedFrameCount++;
          image.close();
        }
      } catch (e) {
        errorMsg = String(e);
      }

      return {
        frameCount, width, height, repetitionCount, decodedFrameCount,
        distinctFrameContentCount: frameHashes.size, headerOk, trailerOk, errorMsg,
      };
    }, gen);

    const r = result as unknown as GifCheckResult;
    expect(r.errorMsg).toBeNull();
    expect(r.headerOk).toBe(true);
    expect(r.trailerOk).toBe(true);
    expect(r.width).toBe(160);
    expect(r.height).toBe(100);
    expect(r.frameCount).toBeGreaterThan(1);
    // Every frame in the container must actually be decodable — a real
    // decoder rejecting even one frame (the exact "Unexpected end of image"
    // failure mode this encoder hit during development) fails this outright.
    expect(r.decodedFrameCount).toBe(r.frameCount);
    expect(r.repetitionCount).toBe('infinite');
    // A live, playing world over 20 generations must produce more than one
    // distinct frame — proves this isn't accidentally emitting the same
    // (possibly wrong) frame repeatedly.
    expect(r.distinctFrameContentCount).toBeGreaterThan(1);
  });

  test('handles a genuinely colourful frame (lineage lens) via median-cut without Chromium rejecting it', async ({ page }) => {
    await openApp(page);
    await dismissTitle(page);
    await ensurePaused(page);
    await page.waitForTimeout(300);
    const gen = await realGen(page);

    const result = await page.evaluate(async (toGen) => {
      const mod = await import('/src/export/index.ts');
      const storeMod = await import('/src/ui/store.ts');
      storeMod.useAppStore.getState().setLens('lineage');

      const fromGen = Math.max(0, toGen - 10);
      const handle = mod.exportWorldGif({
        fromGen, toGen, width: 120, height: 80, fps: 6, gensPerSecond: 12, annotate: false,
      });
      const out = await handle.promise;
      const buf = await out.blob.arrayBuffer();
      let errorMsg: string | null = null;
      let frameCount = 0;
      try {
        const decoder = new ImageDecoder({ data: buf, type: 'image/gif' });
        await decoder.tracks.ready;
        frameCount = decoder.tracks.selectedTrack!.frameCount;
        for (let i = 0; i < frameCount; i++) {
          const { image } = await decoder.decode({ frameIndex: i });
          image.close();
        }
      } catch (e) {
        errorMsg = String(e);
      }
      return { errorMsg, frameCount, byteLength: buf.byteLength };
    }, gen);

    expect(result.errorMsg).toBeNull();
    expect(result.frameCount).toBeGreaterThan(0);
    expect(result.byteLength).toBeGreaterThan(0);
  });

  test('GIF and audio-only export are both reachable from the real export dialog', async ({ page }) => {
    await openApp(page);
    await dismissTitle(page);
    await page.getByRole('button', { name: 'Save & export' }).click();
    await page.getByRole('button', { name: 'Export video…' }).click();
    await expect(page.getByRole('button', { name: 'Animated GIF' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Audio only (WAV)' })).toBeVisible();
    await page.getByRole('button', { name: 'Animated GIF' }).click();
    await expect(page.getByText('Animated GIF', { exact: false }).last()).toBeVisible();
  });
});
