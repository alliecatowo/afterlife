import { expect, type Page, test } from '@playwright/test';
import { dismissTitle, ensurePaused, openApp, regionPopulation, worldToScreen } from './utils';

/** The standard glider, top-left anchored, row-major — matches `SPECIMENS`' `bo$2bo$3o!`. */
const GLIDER_CELLS = [0, 1, 0, 0, 0, 1, 1, 1, 1];

async function regionCells(page: Page, rect: { x: number; y: number; w: number; h: number }): Promise<number[]> {
  return page.evaluate((r) => {
    const session = (window as unknown as { __AFTERLIFE__: { engine: { region(rect: typeof r): Uint8Array } } }).__AFTERLIFE__;
    return Array.from(session.engine.region(r));
  }, rect);
}

/** A world rect the opening scene's seeded population never reaches — see `OPENING_SCENE`'s
 *  description ("two travellers cross the empty southern expanse"); every seeded cell has y <= 66. */
const EMPTY_X = 128;
const EMPTY_Y = 130;

test.describe('specimen stamping', () => {
  test('clicking a specimen then the world paints the WHOLE pattern, not one cell', async ({ page }) => {
    await openApp(page);
    await dismissTitle(page);
    await ensurePaused(page);

    // Scoped to a padded box around the (genuinely empty, see EMPTY_X/Y's doc)
    // target rather than the whole world: the opening scene's gun keeps
    // firing gliders elsewhere regardless of this test's own pause timing, so
    // a WHOLE-WORLD population diff is racy — a local one isn't.
    const watchRect = { x: EMPTY_X - 6, y: EMPTY_Y - 6, w: 15, h: 15 };
    const before = await regionPopulation(page, watchRect);

    const gliderBtn = page.locator('button').filter({ has: page.locator('span', { hasText: /^glider$/ }) });
    await expect(gliderBtn).toBeVisible();
    await gliderBtn.click();
    await expect(gliderBtn).toHaveAttribute('aria-pressed', 'true');

    const screen = await worldToScreen(page, EMPTY_X, EMPTY_Y);
    const canvas = page.locator('#world-canvas');
    const box = (await canvas.boundingBox())!;

    // Hover first: the ghost preview should not itself paint anything.
    await page.mouse.move(box.x + screen.x, box.y + screen.y);
    await page.waitForTimeout(80);
    const duringHover = await regionPopulation(page, watchRect);
    expect(duringHover, 'hovering the ghost must not commit cells').toBe(before);

    await page.mouse.click(box.x + screen.x, box.y + screen.y);
    await page.waitForTimeout(150);

    const after = await regionPopulation(page, watchRect);
    expect(after - before, 'stamping a glider must raise population by exactly 5').toBe(5);

    const cells = await regionCells(page, { x: EMPTY_X, y: EMPTY_Y, w: 3, h: 3 });
    expect(cells, 'the stamped cells must form the actual glider pattern').toEqual(GLIDER_CELLS);
  });
});

test.describe('selection move / duplicate / rotate', () => {
  async function seedAsymmetricShape(page: Page, x: number, y: number): Promise<void> {
    // An asymmetric 3x2 tromino-ish shape so a move/rotate is unambiguous to verify.
    await page.evaluate(
      ({ x, y }) => {
        (window as unknown as { __AFTERLIFE__: { applyEdit(op: { kind: 'set'; cells: Array<{ x: number; y: number; alive: boolean }> }): void } }).__AFTERLIFE__.applyEdit({
          kind: 'set',
          cells: [
            { x, y, alive: true },
            { x: x + 1, y, alive: true },
            { x: x + 2, y, alive: true },
            { x, y: y + 1, alive: true },
          ],
        });
      },
      { x, y },
    );
  }

  // Move/duplicate/rotate's actual EDIT-OP math (clear-source, paint-destination,
  // population-preserving, footprint-swap-on-rotate) is covered precisely and
  // deterministically by `tests/input-selection.test.ts` (jsdom, identity
  // camera — exact pixel/cell arithmetic, no chained-drag floating-point
  // drift). This is the real-browser smoke test: one plain drag end to end,
  // through the actual camera/renderer/session commit pipeline.
  test('dragging inside a selection moves its contents through the real commit pipeline', async ({ page }) => {
    await openApp(page);
    await dismissTitle(page);
    await ensurePaused(page);

    const ox = EMPTY_X;
    const oy = EMPTY_Y;
    // Scoped to the local neighbourhood (see the stamping test's note above
    // on why a whole-world population diff is racy against the ever-firing gun).
    const watchRect = { x: ox - 20, y: oy - 20, w: 40, h: 40 };
    await seedAsymmetricShape(page, ox, oy);
    const totalBefore = await regionPopulation(page, watchRect);

    await page.keyboard.press('s'); // select tool
    const canvas = page.locator('#world-canvas');
    const box = (await canvas.boundingBox())!;
    const topLeft = await worldToScreen(page, ox - 1, oy - 1);
    const bottomRight = await worldToScreen(page, ox + 3, oy + 2);
    await page.mouse.move(box.x + topLeft.x, box.y + topLeft.y);
    await page.mouse.down();
    await page.mouse.move(box.x + bottomRight.x, box.y + bottomRight.y, { steps: 4 });
    await page.mouse.up();
    await page.waitForTimeout(80);

    // Drag from a point INSIDE the selection (on a live cell) by (+10, +10) —
    // a generous delta so it's unambiguous even with sub-pixel camera scale.
    const dx = 10;
    const dy = 10;
    const grabPoint = await worldToScreen(page, ox, oy);
    const dropPoint = await worldToScreen(page, ox + dx, oy + dy);
    await page.mouse.move(box.x + grabPoint.x, box.y + grabPoint.y);
    await page.mouse.down();
    await page.mouse.move(box.x + dropPoint.x, box.y + dropPoint.y, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(80);

    const totalAfterMove = await regionPopulation(page, watchRect);
    expect(totalAfterMove, 'a move must not change total population').toBe(totalBefore);
    const originalSpot = await regionPopulation(page, { x: ox - 1, y: oy - 1, w: 5, h: 4 });
    expect(originalSpot, 'the original location must be cleared after a move').toBe(0);

    // The drop point itself is only APPROXIMATE: a real mouse drag through a
    // non-integer camera scale (the establishing camera fit to the real
    // canvas rect — see `fitCameraSpec`) can land the pointer's floor()ed
    // cell a pixel's worth off from the arithmetic `ox + dx`, exactly like a
    // human dragging with a mouse would. Search a small padded window around
    // the intended destination instead of demanding pixel-perfect placement.
    const padded = await regionPopulation(page, { x: ox + dx - 2, y: oy + dy - 2, w: 3 + 4, h: 2 + 4 });
    expect(padded, 'all 4 moved cells must land near the intended drop point').toBe(4);
  });
});
