import { clamp } from '../util/math';
import { type KeepAliveState, MediaKeepAlive } from './keepAlive';
import type { EngineProfile } from './profiles';

/** What the controller needs from a sound engine; lets tests run without Web Audio. */
export interface EngineSound {
  start(): Promise<void>;
  stop(): Promise<void>;
  update(rpm: number, load: number): void;
  setProfile(profile: EngineProfile): void;
  snapshot(): AudioSnapshot;
}

export interface AudioSnapshot {
  /** `off` before the engine starts; otherwise the browser's audio context state. */
  readonly state: AudioContextState | 'off';
  /** Delay between generating a sound and hearing it, when the browser reports it. */
  readonly latencyMs: number | null;
  readonly sampleRate: number | null;
  /** The silent media loop that registers the page as media playback for background play. */
  readonly background: KeepAliveState;
}

interface Graph {
  readonly ctx: AudioContext;
  readonly noiseBuffer: AudioBuffer;
  readonly fire: OscillatorNode;
  readonly half: OscillatorNode;
  readonly crank: OscillatorNode;
  readonly turbo: OscillatorNode;
  readonly fireGain: GainNode;
  readonly halfGain: GainNode;
  readonly lumpDepth: GainNode;
  readonly noiseFilter: BiquadFilterNode;
  readonly noiseGain: GainNode;
  readonly turboGain: GainNode;
  readonly tone: BiquadFilterNode;
  readonly shaper: WaveShaperNode;
  readonly master: GainNode;
}

const PARAM_SMOOTHING_S = 0.04;
const FADE_IN_S = 0.25;
const FADE_OUT_S = 0.35;
const NOISE_SECONDS = 2;
/** Without a user gesture some browsers never settle `resume()`, so stop waiting after this. */
const RESUME_TIMEOUT_MS = 600;

/**
 * Additive engine synthesizer built on the Web Audio API.
 *
 * The firing frequency (rpm / 60 x firings per revolution) drives a harmonic oscillator, a
 * half-order rumble, crank-speed amplitude modulation, and band-passed noise. The mix runs
 * through a lowpass that opens with revs and throttle, soft clipping, and a limiter.
 */
export class EngineSynth implements EngineSound {
  private profile: EngineProfile;
  private graph: Graph | null = null;
  /** True from start() until stop(), including while restart() swaps the audio graph. */
  private wanted = false;
  private readonly keepAlive = new MediaKeepAlive();
  private backgroundPlay = false;
  private volume = 0.6;
  private muted = false;
  private crackleScale = 1;
  private spool = 0;
  private overrunS = 0;
  private lastUpdateS = 0;

  constructor(profile: EngineProfile) {
    this.profile = profile;
  }

  static isSupported(): boolean {
    return typeof AudioContext !== 'undefined';
  }

  get isMuted(): boolean {
    return this.muted;
  }

  async start(): Promise<void> {
    this.wanted = true;
    if (this.graph) return;
    // Start media playback first, while the gesture that started the engine still counts.
    if (this.backgroundPlay) void this.keepAlive.play();
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    this.graph = buildGraph(ctx, this.profile);
    this.spool = 0;
    this.overrunS = 0;
    this.lastUpdateS = ctx.currentTime;
    // Browsers keep new audio contexts suspended until a user gesture resumes them. If this
    // start did not come from a gesture, the engine runs silently until the next tap.
    await this.resume();
    this.applyVolume(FADE_IN_S);
  }

  /** Resumes audio after autoplay blocking or an interruption; true when sound is playing. */
  async resume(): Promise<boolean> {
    const graph = this.graph;
    if (!graph) return false;
    if (this.backgroundPlay && this.keepAlive.state !== 'playing') void this.keepAlive.play();
    if (graph.ctx.state !== 'running') {
      try {
        await Promise.race([
          graph.ctx.resume(),
          new Promise((resolve) => setTimeout(resolve, RESUME_TIMEOUT_MS)),
        ]);
      } catch {
        // Still blocked; the caller retries on the next user gesture.
      }
    }
    return graph.ctx.state === 'running';
  }

  /**
   * Rebuilds the audio engine on a fresh audio context, which clears silent starts that
   * `resume()` cannot fix. Call it from a user gesture.
   */
  async restart(): Promise<void> {
    const graph = this.graph;
    if (!graph) return;
    this.graph = null;
    this.keepAlive.stop();
    await fadeOutAndClose(graph);
    // The engine may have been switched off while the old graph faded out.
    if (this.wanted) await this.start();
  }

  /** Registers the engine as media playback so cars can keep it going behind other screens. */
  setBackgroundPlay(enabled: boolean): void {
    this.backgroundPlay = enabled;
    if (!enabled) this.keepAlive.stop();
    else if (this.graph) void this.keepAlive.play();
  }

  snapshot(): AudioSnapshot {
    const graph = this.graph;
    const background = this.keepAlive.state;
    if (!graph) return { state: 'off', latencyMs: null, sampleRate: null, background };
    const { ctx } = graph;
    const outputLatencyS = Number.isFinite(ctx.outputLatency) ? ctx.outputLatency : 0;
    return {
      state: ctx.state,
      latencyMs: Math.round((ctx.baseLatency + outputLatencyS) * 1000),
      sampleRate: ctx.sampleRate,
      background,
    };
  }

  async stop(): Promise<void> {
    this.wanted = false;
    const graph = this.graph;
    if (!graph) return;
    this.graph = null;
    this.keepAlive.stop();
    await fadeOutAndClose(graph);
  }

  setProfile(profile: EngineProfile): void {
    this.profile = profile;
    const graph = this.graph;
    if (!graph) return;
    graph.fire.setPeriodicWave(createHarmonicWave(graph.ctx, profile.sound.harmonics));
    graph.shaper.curve = distortionCurve(profile.sound.drive);
  }

  setVolume(volume: number): void {
    this.volume = clamp(volume, 0, 1);
    this.applyVolume(PARAM_SMOOTHING_S);
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.applyVolume(PARAM_SMOOTHING_S);
  }

  /** Scales each engine's pops and crackles: 0 is a clean engine, 1 the profile default. */
  setCrackle(scale: number): void {
    this.crackleScale = clamp(scale, 0, 2);
  }

  update(rpm: number, load: number): void {
    const graph = this.graph;
    if (!graph) return;
    const now = graph.ctx.currentTime;
    const dtS = clamp(now - this.lastUpdateS, 0, 0.25);
    this.lastUpdateS = now;

    const { idleRpm, redlineRpm, firingsPerRevolution, sound } = this.profile;
    const throttle = clamp(load, 0, 1);
    const revs = clamp((rpm - idleRpm) / (redlineRpm - idleRpm), 0, 1);
    const crankHz = Math.max(rpm, 1) / 60;
    const fireHz = crankHz * firingsPerRevolution;
    const level = (0.35 + 0.65 * throttle) * (0.55 + 0.45 * revs);

    setParam(graph.fire.frequency, fireHz, now);
    setParam(graph.half.frequency, fireHz / 2, now);
    setParam(graph.crank.frequency, crankHz, now);
    setParam(graph.fireGain.gain, 0.5 * level, now);
    setParam(graph.halfGain.gain, sound.halfOrder * 0.55 * level * (1 - 0.6 * revs), now);
    setParam(graph.lumpDepth.gain, sound.lumpiness * 0.45 * (1 - revs), now);
    setParam(graph.noiseFilter.frequency, clamp(fireHz * 3, 180, 9000), now);
    setParam(graph.noiseGain.gain, sound.noise * (0.06 + 0.3 * throttle) * (0.4 + 0.6 * revs), now);
    setParam(
      graph.tone.frequency,
      clamp((350 + 2600 * revs + 1400 * throttle) * sound.brightness, 200, 12000),
      now,
    );

    this.spool += (throttle * revs - this.spool) * (1 - Math.exp(-dtS / 0.6));
    setParam(graph.turbo.frequency, 1500 + 6000 * this.spool, now);
    setParam(graph.turboGain.gain, sound.turbo * 0.035 * this.spool * this.spool, now);

    this.overrunS = throttle < 0.06 ? this.overrunS + dtS : 0;
    const crackle = Math.min(1, sound.crackle * this.crackleScale);
    const crackleChance = crackle * 0.25 * revs * Math.max(0, 1 - this.overrunS / 2.5);
    if (this.overrunS > 0 && Math.random() < crackleChance) {
      firePop(graph, crackle, now);
    }
  }

  private applyVolume(rampS: number): void {
    const graph = this.graph;
    if (!graph) return;
    const target = this.muted ? 0 : this.volume * this.volume * 0.85;
    graph.master.gain.setTargetAtTime(target, graph.ctx.currentTime, rampS);
  }
}

function setParam(param: AudioParam, value: number, now: number): void {
  param.setTargetAtTime(value, now, PARAM_SMOOTHING_S);
}

/** Fades out rather than cutting off, which would click, then releases the audio device. */
async function fadeOutAndClose(graph: Graph): Promise<void> {
  const { ctx, master } = graph;
  const now = ctx.currentTime;
  master.gain.cancelScheduledValues(now);
  master.gain.setValueAtTime(master.gain.value, now);
  master.gain.linearRampToValueAtTime(0, now + FADE_OUT_S);
  await new Promise((resolve) => setTimeout(resolve, FADE_OUT_S * 1000 + 50));
  await ctx.close();
}

function buildGraph(ctx: AudioContext, profile: EngineProfile): Graph {
  const { sound } = profile;
  const noiseBuffer = createNoiseBuffer(ctx, NOISE_SECONDS);

  const fire = new OscillatorNode(ctx, {
    periodicWave: createHarmonicWave(ctx, sound.harmonics),
    frequency: 40,
  });
  const half = new OscillatorNode(ctx, { type: 'triangle', frequency: 20 });
  const crank = new OscillatorNode(ctx, { type: 'sine', frequency: 10 });
  const turbo = new OscillatorNode(ctx, { type: 'sine', frequency: 1500 });
  const noise = new AudioBufferSourceNode(ctx, { buffer: noiseBuffer, loop: true });

  const fireGain = new GainNode(ctx, { gain: 0 });
  const halfGain = new GainNode(ctx, { gain: 0 });
  const lumpDepth = new GainNode(ctx, { gain: 0 });
  const noiseFilter = new BiquadFilterNode(ctx, { type: 'bandpass', frequency: 400, Q: 0.8 });
  const noiseGain = new GainNode(ctx, { gain: 0 });
  const turboGain = new GainNode(ctx, { gain: 0 });
  const mix = new GainNode(ctx, { gain: 1 });
  const tone = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 800, Q: 0.7 });
  const shaper = new WaveShaperNode(ctx, {
    curve: distortionCurve(sound.drive),
    oversample: '4x',
  });
  const body = new BiquadFilterNode(ctx, { type: 'peaking', frequency: 110, Q: 0.9, gain: 3 });
  const master = new GainNode(ctx, { gain: 0 });
  const limiter = new DynamicsCompressorNode(ctx, {
    threshold: -12,
    knee: 6,
    ratio: 8,
    attack: 0.003,
    release: 0.25,
  });

  fire.connect(fireGain).connect(mix);
  half.connect(halfGain).connect(mix);
  noise.connect(noiseFilter).connect(noiseGain).connect(mix);
  // Modulating the mix gain at crankshaft speed adds the uneven pulse of a real idle.
  crank.connect(lumpDepth).connect(mix.gain);
  mix.connect(tone).connect(shaper).connect(body).connect(master);
  turbo.connect(turboGain).connect(body);
  master.connect(limiter).connect(ctx.destination);

  for (const source of [fire, half, crank, turbo, noise]) source.start();

  return {
    ctx,
    noiseBuffer,
    fire,
    half,
    crank,
    turbo,
    fireGain,
    halfGain,
    lumpDepth,
    noiseFilter,
    noiseGain,
    turboGain,
    tone,
    shaper,
    master,
  };
}

function createHarmonicWave(ctx: BaseAudioContext, harmonics: readonly number[]): PeriodicWave {
  const real = new Float32Array(harmonics.length + 1);
  const imag = new Float32Array(harmonics.length + 1);
  harmonics.forEach((amplitude, index) => {
    imag[index + 1] = amplitude;
  });
  return ctx.createPeriodicWave(real, imag);
}

function createNoiseBuffer(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const buffer = ctx.createBuffer(1, Math.round(ctx.sampleRate * seconds), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

/** Soft-clipping transfer curve; more drive adds grit and upper harmonics. */
function distortionCurve(drive: number, samples = 1024): Float32Array<ArrayBuffer> {
  const k = clamp(drive, 0, 1) * 40;
  const curve = new Float32Array(samples);
  for (let i = 0; i < samples; i++) {
    const x = (i * 2) / (samples - 1) - 1;
    curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
  }
  return curve;
}

/** A short burst of filtered noise through the distortion stage, like unburnt fuel popping. */
function firePop(graph: Graph, intensity: number, now: number): void {
  const { ctx, noiseBuffer, shaper } = graph;
  const source = new AudioBufferSourceNode(ctx, { buffer: noiseBuffer });
  const filter = new BiquadFilterNode(ctx, {
    type: 'highpass',
    frequency: 900 + Math.random() * 1600,
  });
  const envelope = new GainNode(ctx, { gain: 0 });
  const decayS = 0.04 + Math.random() * 0.06;
  envelope.gain.setValueAtTime(0, now);
  envelope.gain.linearRampToValueAtTime(0.35 * intensity, now + 0.002);
  envelope.gain.exponentialRampToValueAtTime(0.0001, now + decayS);
  source.connect(filter).connect(envelope).connect(shaper);
  source.addEventListener('ended', () => {
    source.disconnect();
    filter.disconnect();
    envelope.disconnect();
  });
  source.start(now, Math.random() * (noiseBuffer.duration - 0.2), decayS + 0.02);
}
