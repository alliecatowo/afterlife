import { describe, expect, it } from 'vitest';
import { estimatePngZipBytes, estimateWebmBytes, formatBytes, formatDuration } from '@/export/estimate';

describe('export estimate: formatting', () => {
  it('formats bytes across units', () => {
    expect(formatBytes(500)).toBe('500 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
  });

  it('formats durations under and over a minute', () => {
    expect(formatDuration(9.4)).toBe('9.4s');
    expect(formatDuration(75)).toBe('1m 15s');
  });
});

describe('export estimate: size heuristics', () => {
  it('webm estimate scales with resolution, fps and duration', () => {
    const base = estimateWebmBytes(640, 480, 24, 10);
    expect(estimateWebmBytes(1280, 960, 24, 10)).toBeGreaterThan(base);
    expect(estimateWebmBytes(640, 480, 24, 20)).toBeGreaterThan(base);
    expect(base).toBeGreaterThan(0);
  });

  it('png-zip estimate scales with frame count', () => {
    const one = estimatePngZipBytes(640, 480, 1);
    const ten = estimatePngZipBytes(640, 480, 10);
    expect(ten).toBeGreaterThan(one * 5);
  });
});
