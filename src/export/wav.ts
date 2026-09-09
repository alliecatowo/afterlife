/**
 * Hand-written WAV (PCM) encoder — needs no codec support at all, unlike
 * WebM/Opus, so it's the simplest possible "did the deterministic offline
 * render actually work" artifact: a real `AudioBuffer` in, a standard
 * 16-bit-PCM `.wav` file out. Zero new dependencies, per this project's rule.
 */

function writeAsciiString(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
}

/** Encode an `AudioBuffer` (as produced by `@/export/audio/offlineRender.ts`)
 *  to a 16-bit PCM WAV `Blob`. Interleaves channels in the standard WAV
 *  order; clamps out-of-range samples rather than wrapping (a real Web Audio
 *  graph can produce values slightly outside [-1, 1] after gain/reverb). */
export function encodeWav(buffer: AudioBuffer): Blob {
  const numChannels = Math.max(1, buffer.numberOfChannels);
  const sampleRate = buffer.sampleRate;
  const numFrames = buffer.length;
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const dataSize = numFrames * blockAlign;
  const headerSize = 44;

  const out = new ArrayBuffer(headerSize + dataSize);
  const view = new DataView(out);

  writeAsciiString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeAsciiString(view, 8, 'WAVE');
  writeAsciiString(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // PCM fmt chunk size
  view.setUint16(20, 1, true); // format tag: 1 = PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true); // byte rate
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bytesPerSample * 8, true); // bits per sample
  writeAsciiString(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  const channels: Float32Array[] = [];
  for (let c = 0; c < numChannels; c++) channels.push(buffer.getChannelData(c));

  let offset = headerSize;
  for (let i = 0; i < numFrames; i++) {
    for (let c = 0; c < numChannels; c++) {
      const sample = Math.max(-1, Math.min(1, channels[c]![i]!));
      const intSample = Math.round(sample < 0 ? sample * 0x8000 : sample * 0x7fff);
      view.setInt16(offset, intSample, true);
      offset += 2;
    }
  }

  return new Blob([out], { type: 'audio/wav' });
}
