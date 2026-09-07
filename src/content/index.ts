/**
 * Content layer — public API.
 *
 * Owned modules: `scenes` (the four curated worlds and their cameras/beats),
 * `specimens` (the 24-entry drawer/Field Guide corpus), `recognition`
 * (orientation/phase-exact matching + bounded repetition observation),
 * `experiments` (the three authored challenges and their pure evaluators),
 * `discoveries` (bookmark/name/follow, the Field Guide's growth model), and
 * `patterns` (the thin façade `src/ui/drawer/Drawer.tsx` already imports —
 * kept for that existing contract).
 *
 * An integration agent should import from here rather than reaching into
 * individual files, except where a file is already a named contract
 * elsewhere (`@/content/patterns`'s `PATTERNS`/`getPattern`, already wired
 * into the drawer).
 */

export * from '@/content/scenes';
export * from '@/content/specimens';
export * from '@/content/recognition';
export * from '@/content/experiments';
export * from '@/content/discoveries';
export { PATTERNS, getPattern, createDiscoveryDetector, type PatternEntry, type DiscoveryDetector } from '@/content/patterns';
export { MiniaturePreview, type MiniaturePreviewProps } from '@/content/MiniaturePreview';
