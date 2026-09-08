/**
 * Filename + burned-in annotation text generation. Pure. Keeps every export
 * self-describing (rule, generation range, seed) so a shared clip carries
 * enough information to be understood — and, given the source save, replayed
 * — without the app open next to it.
 */

export interface AnnotationInfo {
  rule: string;
  fromGen: number;
  toGen: number;
  /** Present for parity with the still-image exports' annotation; this app's
   *  worlds are hand-drawn from a curated scene rather than a procedural RNG
   *  seed, so this is usually `0` — included honestly, never omitted to hide
   *  that it's not meaningful, never fabricated as something more specific. */
  seed?: number;
}

export function buildAnnotationText(info: AnnotationInfo): string {
  const seedPart = info.seed !== undefined ? ` · seed ${info.seed}` : '';
  return `${info.rule} — gen ${info.fromGen}–${info.toGen}${seedPart} · AFTERLIFE`;
}

function slugify(s: string): string {
  return s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'afterlife';
}

export interface FilenameInfo {
  kind: string;
  fromGen: number;
  toGen: number;
  ext: string;
}

export function buildExportFilename(info: FilenameInfo): string {
  return `afterlife-${slugify(info.kind)}-gen${info.fromGen}-${info.toGen}.${info.ext}`;
}
