import { afterEach, describe, expect, it } from 'vitest';
import { clampScale, createCamera, MAX_SCALE, MIN_SCALE, smoothDamp, zoomAt } from '@/render/camera';
import { projectScreenToWorld, projectWorldToScreen } from '@/render/renderer';

const viewport = { width: 800, height: 600 };

describe('camera: cursor-centred zoom invariant', () => {
  it('keeps the world point under the cursor fixed across a zoom-in', () => {
    const cam = { x: 12.5, y: -4.25, scale: 6 };
    const screen = { x: 530, y: 140 };
    const before = projectScreenToWorld(cam, viewport, screen.x, screen.y);

    const after = zoomAt(cam, screen.x, screen.y, 2.4, viewport);
    const afterWorld = projectScreenToWorld(after, viewport, screen.x, screen.y);

    expect(afterWorld.x).toBeCloseTo(before.x, 9);
    expect(afterWorld.y).toBeCloseTo(before.y, 9);
  });

  it('keeps the world point under the cursor fixed across a zoom-out', () => {
    const cam = { x: -100, y: 250, scale: 12 };
    const screen = { x: 10, y: 590 };
    const before = projectScreenToWorld(cam, viewport, screen.x, screen.y);

    const after = zoomAt(cam, screen.x, screen.y, 1 / 3, viewport);
    const afterWorld = projectScreenToWorld(after, viewport, screen.x, screen.y);

    expect(afterWorld.x).toBeCloseTo(before.x, 9);
    expect(afterWorld.y).toBeCloseTo(before.y, 9);
  });

  it('holds across repeated zooms at different cursor positions', () => {
    let cam = { x: 0, y: 0, scale: 4 };
    const points = [{ x: 200, y: 100 }, { x: 600, y: 500 }, { x: 400, y: 300 }];
    for (const p of points) {
      const before = projectScreenToWorld(cam, viewport, p.x, p.y);
      cam = zoomAt(cam, p.x, p.y, 1.7, viewport);
      const after = projectScreenToWorld(cam, viewport, p.x, p.y);
      expect(after.x).toBeCloseTo(before.x, 9);
      expect(after.y).toBeCloseTo(before.y, 9);
    }
  });

  it('clamps scale to [MIN_SCALE, MAX_SCALE]', () => {
    expect(clampScale(0.0001)).toBe(MIN_SCALE);
    expect(clampScale(10000)).toBe(MAX_SCALE);
    expect(clampScale(5)).toBe(5);
  });

  it('is a no-op at the scale ceiling/floor (does not silently drift x/y)', () => {
    const cam = { x: 3, y: 3, scale: MAX_SCALE };
    const after = zoomAt(cam, 400, 300, 5, viewport); // already at ceiling, zooming further in
    expect(after.scale).toBe(MAX_SCALE);
    expect(after.x).toBe(cam.x);
    expect(after.y).toBe(cam.y);
  });
});

describe('camera: screenToWorld / worldToScreen round trip', () => {
  it('is an exact inverse for arbitrary points', () => {
    const cam = { x: 17, y: -33.5, scale: 9.25 };
    const vp = { width: 1024, height: 768 };
    const samples: Array<[number, number]> = [[0, 0], [1024, 768], [512.5, 384.25], [-40, 900], [3, 700]];
    for (const [px, py] of samples) {
      const world = projectScreenToWorld(cam, vp, px, py);
      const back = projectWorldToScreen(cam, vp, world.x, world.y);
      expect(back.x).toBeCloseTo(px, 9);
      expect(back.y).toBeCloseTo(py, 9);
    }
  });

  it('is an exact inverse in the other direction (world -> screen -> world)', () => {
    const cam = { x: -5, y: 200, scale: 2.5 };
    const vp = { width: 640, height: 480 };
    const worldPts: Array<[number, number]> = [[0, 0], [-500, 500], [123.456, -78.9]];
    for (const [wx, wy] of worldPts) {
      const screen = projectWorldToScreen(cam, vp, wx, wy);
      const back = projectScreenToWorld(cam, vp, screen.x, screen.y);
      expect(back.x).toBeCloseTo(wx, 9);
      expect(back.y).toBeCloseTo(wy, 9);
    }
  });
});

describe('camera controller', () => {
  it('panByScreen moves the world-space centre opposite the screen delta, scaled', () => {
    const cam = createCamera({ x: 0, y: 0, scale: 10 });
    cam.setViewport(800, 600);
    cam.panByScreen(100, -50);
    expect(cam.camera.x).toBeCloseTo(-10, 9);
    expect(cam.camera.y).toBeCloseTo(5, 9);
  });

  it('releaseFollow fires the instant the user pans or zooms', () => {
    const cam = createCamera({ x: 0, y: 0, scale: 10 });
    cam.setViewport(800, 600);
    cam.follow({ x: 100, y: 100 });
    expect(cam.following).toBe(true);
    cam.panByScreen(1, 1);
    expect(cam.following).toBe(false);

    cam.follow({ x: 100, y: 100 });
    expect(cam.following).toBe(true);
    cam.zoomAt({ x: 400, y: 300 }, 1.1);
    expect(cam.following).toBe(false);
  });

  it('follow eases toward a moving target without overshooting wildly', () => {
    const cam = createCamera({ x: 0, y: 0, scale: 10 });
    cam.setViewport(800, 600);
    cam.follow({ x: 100, y: 0 });
    for (let i = 0; i < 240; i++) cam.tick(1 / 60);
    expect(cam.camera.x).toBeCloseTo(100, 1);
  });

  it('smoothDamp converges to the target and is stable at dt=0', () => {
    const vel = { v: 0 };
    let x = 0;
    for (let i = 0; i < 500; i++) x = smoothDamp(x, 10, vel, 0.25, 1 / 60);
    expect(x).toBeCloseTo(10, 2);
    const vel2 = { v: 0 };
    expect(smoothDamp(5, 10, vel2, 0.25, 0)).toBe(5);
  });

  describe('prefers-reduced-motion: follow() snaps instead of easing', () => {
    // jsdom doesn't implement `matchMedia` at all (calling it throws) — this
    // is exactly the environment `reducedMotionPreferred()`'s `?.()` guard is
    // for, and doubles as a check that camera code never crashes here even
    // though the OTHER tests in this file (no stub installed) exercise the
    // real, non-reduced easing path throughout.
    afterEach(() => {
      // @ts-expect-error test-only cleanup of a property this suite adds
      delete window.matchMedia;
    });

    function stubReducedMotion(matches: boolean): void {
      window.matchMedia = ((query: string) => ({
        matches,
        media: query,
        addEventListener() {},
        removeEventListener() {},
        addListener() {},
        removeListener() {},
        dispatchEvent() { return false; },
      })) as unknown as typeof window.matchMedia;
    }

    it('jumps straight to the target on the very first tick when the OS prefers reduced motion', () => {
      stubReducedMotion(true);
      const cam = createCamera({ x: 0, y: 0, scale: 10 });
      cam.setViewport(800, 600);
      cam.follow({ x: 100, y: -40 });
      cam.tick(1 / 60); // a single frame — no 240-tick easing run needed
      expect(cam.camera.x).toBe(100);
      expect(cam.camera.y).toBe(-40);
    });

    it('still eases normally once reduced motion is switched back off', () => {
      stubReducedMotion(false);
      const cam = createCamera({ x: 0, y: 0, scale: 10 });
      cam.setViewport(800, 600);
      cam.follow({ x: 100, y: 0 });
      cam.tick(1 / 60);
      // A single 1/60s tick of a 0.28s-smoothtime damp cannot have arrived yet.
      expect(cam.camera.x).toBeGreaterThan(0);
      expect(cam.camera.x).toBeLessThan(100);
    });
  });

  // `follow()`'s optional second argument — added for cinematic mode
  // (`@/ui/cinematic/director.ts`), which combines a pan with a zoom change
  // (easing into a close-up, pulling back to an establishing wide shot)
  // without a hard cut. Kept in this file (not a new one) since it's the
  // same `follow()`/`tick()` contract the tests above already cover.
  describe('follow() with a target scale', () => {
    it('leaves scale untouched when no target scale is given (existing scene-beat callers are unaffected)', () => {
      const cam = createCamera({ x: 0, y: 0, scale: 10 });
      cam.setViewport(800, 600);
      cam.follow({ x: 50, y: 50 });
      for (let i = 0; i < 60; i++) cam.tick(1 / 60);
      expect(cam.camera.scale).toBe(10);
    });

    it('eases scale toward the target independently of x/y position easing', () => {
      const cam = createCamera({ x: 0, y: 0, scale: 10 });
      cam.setViewport(800, 600);
      cam.follow({ x: 100, y: 0 }, 20);
      cam.tick(1 / 60);
      // Neither has arrived yet, but both are moving toward their targets.
      expect(cam.camera.scale).toBeGreaterThan(10);
      expect(cam.camera.scale).toBeLessThan(20);
      for (let i = 0; i < 600; i++) cam.tick(1 / 60);
      expect(cam.camera.scale).toBeCloseTo(20, 1);
      expect(cam.camera.x).toBeCloseTo(100, 1);
    });

    it('clamps an out-of-range target scale to [MIN_SCALE, MAX_SCALE]', () => {
      const cam = createCamera({ x: 0, y: 0, scale: 10 });
      cam.setViewport(800, 600);
      cam.follow({ x: 0, y: 0 }, 9999);
      for (let i = 0; i < 2000; i++) cam.tick(1 / 60);
      expect(cam.camera.scale).toBeCloseTo(MAX_SCALE, 6);
    });

    it('a later follow() call without a target scale stops animating scale (releases the previous scale target)', () => {
      const cam = createCamera({ x: 0, y: 0, scale: 10 });
      cam.setViewport(800, 600);
      cam.follow({ x: 0, y: 0 }, 20);
      cam.tick(1 / 60);
      const midScale = cam.camera.scale;
      expect(midScale).toBeGreaterThan(10);
      cam.follow({ x: 5, y: 5 }); // no target scale this time
      cam.tick(1 / 60);
      expect(cam.camera.scale).toBe(midScale); // held exactly where it was, not still drifting toward 20
    });

    describe('prefers-reduced-motion also applies to the scale target', () => {
      afterEach(() => {
        // @ts-expect-error test-only cleanup of a property this suite adds
        delete window.matchMedia;
      });

      it('snaps straight to the target scale, not just the target position', () => {
        window.matchMedia = ((query: string) => ({
          matches: true,
          media: query,
          addEventListener() {},
          removeEventListener() {},
          addListener() {},
          removeListener() {},
          dispatchEvent() { return false; },
        })) as unknown as typeof window.matchMedia;
        const cam = createCamera({ x: 0, y: 0, scale: 10 });
        cam.setViewport(800, 600);
        cam.follow({ x: 40, y: -10 }, 22);
        cam.tick(1 / 60);
        expect(cam.camera.x).toBe(40);
        expect(cam.camera.y).toBe(-10);
        expect(cam.camera.scale).toBe(22);
      });
    });
  });
});
