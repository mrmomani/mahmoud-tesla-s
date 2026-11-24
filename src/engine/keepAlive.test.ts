import { describe, expect, it } from 'vitest';
import { silentWav } from './keepAlive';

describe('silentWav', () => {
  it('builds a well-formed WAV file that contains only silence', () => {
    const wav = silentWav(1, 8000);
    const view = new DataView(wav.buffer);
    const tag = (offset: number): string =>
      String.fromCharCode(...wav.subarray(offset, offset + 4));

    expect([tag(0), tag(8), tag(12), tag(36)]).toEqual(['RIFF', 'WAVE', 'fmt ', 'data']);
    expect(view.getUint32(4, true)).toBe(wav.length - 8);
    expect(view.getUint32(24, true)).toBe(8000);
    expect(view.getUint32(40, true)).toBe(8000);
    expect(wav.length).toBe(44 + 8000);
    expect(wav.subarray(44).every((sample) => sample === 128)).toBe(true);
  });
});
