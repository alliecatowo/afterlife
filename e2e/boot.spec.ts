import { expect, test } from '@playwright/test';
import { cameraState, collectConsoleErrors, dismissTitle, openApp, realGen, regionPopulation, waitForGen } from './utils';
import { OPENING_VERIFIED } from '../src/content/scenes';

test.describe('boot', () => {
  test('opens directly into the opening scene, zero console errors', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await openApp(page);

    await expect(page.getByText('AFTERLIFE', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Every future leaves a trace.')).toBeVisible();
    await expect(page.getByText('touch the world to begin')).toBeVisible();

    // Real, deterministic run of the shipped engine: generation 0 starts at the
    // verified opening population (250 cells), not an empty or random world.
    await page.waitForTimeout(300);
    const pop0 = await page.getByTestId('hud-pop').textContent();
    expect(Number(pop0)).toBeGreaterThan(0);

    expect(errors, `console errors: ${errors.join('\n')}`).toEqual([]);
  });

  test('first pointer interaction dismisses the title immediately, no modal gate', async ({ page }) => {
    await openApp(page);
    const plate = page.getByTestId('title-plate');
    await expect(plate).toHaveAttribute('aria-hidden', 'false');
    await dismissTitle(page);
    // The plate fades rather than vanishing (see its own doc comment) — "dismissed"
    // is signalled by `aria-hidden`, not by disappearing from the layout.
    await expect(plate).toHaveAttribute('aria-hidden', 'true');
  });

  test('reaches the verified encounter at generation 123', async ({ page }) => {
    await openApp(page);
    await dismissTitle(page);

    // Before the encounter: the southern expanse is quiet.
    const before = await regionPopulation(page, OPENING_VERIFIED.encounterBbox);

    // The opening scene autoplays on boot at its default 12 gens/sec — this
    // observes the real, un-sped-up transport reaching the verified moment,
    // no manual "press play" required (see the HUD's "pause time anytime"
    // invitation, only sensible if time is already moving).
    await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
    await waitForGen(page, OPENING_VERIFIED.encounterGen, 25_000);
    await page.getByRole('button', { name: 'Pause' }).click();

    const gen = await realGen(page);
    expect(gen).toBeGreaterThanOrEqual(OPENING_VERIFIED.encounterGen);

    const after = await regionPopulation(page, OPENING_VERIFIED.encounterBbox);
    // The encounter genuinely changes what's alive in the bounding box.
    expect(after).not.toBe(before);
    expect(after).toBeGreaterThan(0);
  });

  // Real user report: "the 'first contact' things auto panning the camera's
  // focus around by default when not in cinematic mode" — a scene beat must
  // never move the camera during ordinary play (see `session.ts`'s
  // `checkBeats` doc). `OPENING_SCENE`'s `camera-ease` beat fires at gen 108
  // and its `annotate` beat fires at gen 123 (`OPENING_VERIFIED.encounterGen`)
  // — running well past both must leave the camera untouched while the
  // quiet "First contact." annotation still appears.
  test('scene beats never move the camera; the annotation still fires', async ({ page }) => {
    await openApp(page);
    await dismissTitle(page);

    const before = await cameraState(page);
    await waitForGen(page, OPENING_VERIFIED.encounterGen, 25_000);
    const after = await cameraState(page);

    expect(after).toEqual(before);
    await expect(page.getByText('First contact.')).toBeVisible();
  });
});
