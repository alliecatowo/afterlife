// Landing-page-only entry: finds the inline diagram canvas and mounts the
// real B3/S23 simulation from `./glider.ts` onto it, honouring
// prefers-reduced-motion by rendering a single static frame instead of
// animating.
import { mountGliderDiagram } from './glider';

const canvas = document.getElementById('glider-diagram');
if (canvas instanceof HTMLCanvasElement) {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  mountGliderDiagram(canvas, reducedMotion);
}
