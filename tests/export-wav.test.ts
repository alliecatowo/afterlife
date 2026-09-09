import { describe, expect, it } from 'vitest';
import { encodeWav } from '@/export/wav';

/** A minimal `AudioBuffer`-shaped test double — jsdom has no real Web Audio
 *  implementation, but `encodeWav` only ever calls `numberOfChannels`,
 *  `sampleRate`, `length`, and `getChannelData`, so a plain object suffices. */
function fakeAudioBuffer(channels: Float32Array[], sampleRate: number): AudioBuffer {
  return {
    numberOfChannels: channels.length,
    sampleRate,
    length: channels[0]?.length ?? 0,
    getChannelData: (c: number) => channels[c]!,
  } as unknown as AudioBuffer;
}

function readWav(blob: Blob): Promise<{ view: DataView; bytes: Uint8Array }> {
  return blob.arrayBuffer().then((buf) => {
    const bytes = new Uint8Array(buf);
    return { view: new DataView(buf), bytes };
  });
}

function asciiAt(bytes: Uint8Array, offset: number, len: number): string {
  return String.fromCharCode(...bytes.slice(offset, offset + len));
}

describe('encodeWav', () => {
  it('writes a valid RIFF/WAVE header with correct chunk sizes', async () => {
    const channels = [new Float32Array([0, 0.5, -0.5, 1, -1])];
    const buffer = fakeAudioBuffer(channels, 44100);
    const blob = encodeWav(buffer);
    expect(blob.type).toBe('audio/wav');
    const { view, bytes } = await readWav(blob);

    expect(asciiAt(bytes, 0, 4)).toBe('RIFF');
    expect(asciiAt(bytes, 8, 4)).toBe('WAVE');
    expect(asciiAt(bytes, 12, 4)).toBe('fmt ');
    expect(asciiAt(bytes, 36, 4)).toBe('data');

    const dataSize = 5 * 1 * 2; // 5 frames, 1 channel, 16-bit
    expect(view.getUint32(40, true)).toBe(dataSize);
    expect(view.getUint32(4, true)).toBe(36 + dataSize);
    expect(view.getUint16(20, true)).toBe(1); // PCM
    expect(view.getUint16(22, true)).toBe(1); // mono
    expect(view.getUint32(24, true)).toBe(44100);
    expect(view.getUint16(34, true)).toBe(16); // bits per sample
    expect(blob.size).toBe(44 + dataSize);
  });

  it('round-trips sample values (mono) within 16-bit quantisation error', async () => {
    const samples = [0, 0.5, -0.5, 1, -1, 0.25];
    const buffer = fakeAudioBuffer([new Float32Array(samples)], 8000);
    const blob = encodeWav(buffer);
    const { view } = await readWav(blob);
    for (let i = 0; i < samples.length; i++) {
      const raw = view.getInt16(44 + i * 2, true);
      const decoded = raw / (raw < 0 ? 0x8000 : 0x7fff);
      expect(decoded).toBeCloseTo(samples[i]!, 3);
    }
  });

  it('interleaves stereo channels in L,R,L,R order', async () => {
    const left = new Float32Array([1, -1]);
    const right = new Float32Array([-1, 1]);
    const buffer = fakeAudioBuffer([left, right], 44100);
    const blob = encodeWav(buffer);
    const { view } = await readWav(blob);
    expect(view.getInt16(44 + 0, true)).toBeGreaterThan(30000); // L[0] = 1
    expect(view.getInt16(44 + 2, true)).toBeLessThan(-30000); // R[0] = -1
    expect(view.getInt16(44 + 4, true)).toBeLessThan(-30000); // L[1] = -1
    expect(view.getInt16(44 + 6, true)).toBeGreaterThan(30000); // R[1] = 1
  });

  it('clamps out-of-range samples rather than wrapping', async () => {
    const buffer = fakeAudioBuffer([new Float32Array([2.5, -3.0])], 44100);
    const blob = encodeWav(buffer);
    const { view } = await readWav(blob);
    expect(view.getInt16(44, true)).toBe(0x7fff);
    expect(view.getInt16(46, true)).toBe(-0x8000);
  });

  it('produces a valid (empty-data) file for a zero-length buffer', async () => {
    const buffer = fakeAudioBuffer([new Float32Array(0)], 44100);
    const blob = encodeWav(buffer);
    expect(blob.size).toBe(44);
  });
});
