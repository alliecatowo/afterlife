import { describe, expect, it } from 'vitest';
import { buildAnnotationText, buildExportFilename } from '@/export/filename';

describe('export filename/annotation', () => {
  it('builds a descriptive, deterministic filename', () => {
    expect(buildExportFilename({ kind: 'world', fromGen: 10, toGen: 200, ext: 'webm' }))
      .toBe('afterlife-world-gen10-200.webm');
  });

  it('slugifies an unusual kind', () => {
    expect(buildExportFilename({ kind: 'World Frames!!', fromGen: 0, toGen: 1, ext: 'zip' }))
      .toBe('afterlife-world-frames-gen0-1.zip');
  });

  it('includes rule and generation range in the annotation', () => {
    const text = buildAnnotationText({ rule: 'B3/S23', fromGen: 0, toGen: 640 });
    expect(text).toContain('B3/S23');
    expect(text).toContain('0');
    expect(text).toContain('640');
  });

  it('includes seed only when provided, never fabricated', () => {
    expect(buildAnnotationText({ rule: 'B3/S23', fromGen: 0, toGen: 1 })).not.toContain('seed');
    expect(buildAnnotationText({ rule: 'B3/S23', fromGen: 0, toGen: 1, seed: 0 })).toContain('seed 0');
  });
});
