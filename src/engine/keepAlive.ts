/**
 * Length of the silent loop. Browsers treat media shorter than about five seconds as a one-off
 * sound effect rather than as playback that belongs in the media player.
 */
const LOOP_SECONDS = 8;
const SAMPLE_RATE = 8000;
/** 8-bit PCM samples are unsigned, so the midpoint is silence. */
const SILENCE = 128;

export type KeepAliveState = 'off' | 'playing' | 'paused';

/** An 8-bit mono PCM WAV file containing only silence. */
export function silentWav(seconds: number, sampleRate = SAMPLE_RATE): Uint8Array<ArrayBuffer> {
  const samples = Math.round(seconds * sampleRate);
  const bytes = new Uint8Array(44 + samples);
  const view = new DataView(bytes.buffer);
  const ascii = (offset: number, text: string): void => {
    for (let i = 0; i < text.length; i++) bytes[offset + i] = text.charCodeAt(i);
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + samples, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate, true); // bytes per second at one byte per sample
  view.setUint16(32, 1, true); // block align
  view.setUint16(34, 8, true); // bits per sample
  ascii(36, 'data');
  view.setUint32(40, samples, true);
  bytes.fill(SILENCE, 44);
  return bytes;
}

/**
 * Loops a silent audio file so the browser registers the page as media playback, the kind a car
 * can keep playing while another screen is open. The engine itself stays on Web Audio.
 */
export class MediaKeepAlive {
  private player: HTMLAudioElement | null = null;
  private url: string | null = null;

  get state(): KeepAliveState {
    if (!this.player) return 'off';
    return this.player.paused ? 'paused' : 'playing';
  }

  /** The first call must come from a user gesture; later calls resume after an interruption. */
  async play(): Promise<void> {
    if (!this.player) {
      this.url = URL.createObjectURL(new Blob([silentWav(LOOP_SECONDS)], { type: 'audio/wav' }));
      this.player = new Audio(this.url);
      this.player.loop = true;
    }
    try {
      await this.player.play();
    } catch {
      // Blocked until the next tap, which calls play() again.
    }
  }

  stop(): void {
    const player = this.player;
    if (player) {
      player.pause();
      player.removeAttribute('src');
      player.load();
    }
    if (this.url) URL.revokeObjectURL(this.url);
    this.player = null;
    this.url = null;
  }
}
