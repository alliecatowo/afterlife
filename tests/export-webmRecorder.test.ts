import { describe, expect, it } from 'vitest';
import { pickSupportedMimeType, WEBM_MIME_CANDIDATES } from '@/export/webmRecorder';

describe('webmRecorder: pickSupportedMimeType', () => {
  it('picks the first supported candidate, in preference order', () => {
    const supported = new Set(['video/webm;codecs=vp8', 'video/webm']);
    const picked = pickSupportedMimeType(WEBM_MIME_CANDIDATES, (t) => supported.has(t));
    expect(picked).toBe('video/webm;codecs=vp8');
  });

  it('returns null when nothing is supported, never a fabricated guess', () => {
    expect(pickSupportedMimeType(WEBM_MIME_CANDIDATES, () => false)).toBeNull();
  });

  it('prefers vp9 over vp8 when both are available', () => {
    const picked = pickSupportedMimeType(WEBM_MIME_CANDIDATES, () => true);
    expect(picked).toBe(WEBM_MIME_CANDIDATES[0]);
  });
});
