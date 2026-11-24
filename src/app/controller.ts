import {
  type DrivetrainState,
  estimateLoad,
  gearLabel,
  NEUTRAL,
  STARTUP_DURATION_S,
  startupFlareRpm,
  stepDrivetrain,
} from '../engine/drivetrain';
import type { EngineProfile } from '../engine/profiles';
import type { AudioSnapshot, EngineSound } from '../engine/synth';
import { demoSpeedKmh } from '../speed/demo';
import type { GpsSnapshot, GpsSource } from '../speed/gpsSource';
import { stepTestDrive } from '../speed/testDrive';
import { approach, clamp, smoothToward } from '../util/math';

export type SpeedMode = 'gps' | 'demo' | 'test';
export type Pedal = 'gas' | 'brake';

export interface Telemetry {
  readonly running: boolean;
  readonly mode: SpeedMode;
  readonly speedKmh: number;
  readonly rpm: number;
  readonly gear: string;
  /** Estimated throttle, from 0 to 1. */
  readonly load: number;
  readonly redlineRpm: number;
  readonly canRev: boolean;
  readonly gps: GpsSnapshot;
  readonly audio: AudioSnapshot;
}

type Scheduler = (tick: () => void, intervalMs: number) => () => void;

export interface ControllerOptions {
  readonly sound: EngineSound;
  readonly gps: GpsSource;
  readonly profile: EngineProfile;
  readonly mode: SpeedMode;
  /** How eagerly acceleration becomes throttle, from 0 (relaxed) to 1 (aggressive). */
  readonly intensity?: number;
  readonly onTelemetry: (telemetry: Telemetry) => void;
  /** Monotonic clock in milliseconds. */
  readonly now?: () => number;
  /** Wall clock in epoch milliseconds, the time base of GPS fixes. */
  readonly wallClock?: () => number;
  readonly schedule?: Scheduler;
}

/** Revving in place is only allowed while (nearly) stopped. */
export const REV_MAX_SPEED_KMH = 5;
const TICK_MS = 40;
const SHIFT_CUT_MS = 140;
// Must exceed one tick of full-throttle rise (9000 rpm/s x 40 ms) so the limiter audibly stutters.
const LIMITER_DROP_RPM = 600;
// The GPS estimator already projects speed between fixes, so it only needs light smoothing.
const SPEED_SMOOTHING_S: Record<SpeedMode, number> = { gps: 0.25, demo: 0.1, test: 0.05 };

// A timer rather than requestAnimationFrame: audible pages keep their timers running even when
// the browser is hidden, so the engine keeps following the speed in the background.
const intervalScheduler: Scheduler = (tick, intervalMs) => {
  const id = setInterval(tick, intervalMs);
  return () => clearInterval(id);
};

/** Runs the simulation loop: speed source -> load -> gear and rpm -> sound and gauges. */
export class EngineController {
  private readonly sound: EngineSound;
  private readonly gps: GpsSource;
  private readonly onTelemetry: (telemetry: Telemetry) => void;
  private readonly now: () => number;
  private readonly wallClock: () => number;
  private readonly schedule: Scheduler;

  private profile: EngineProfile;
  private mode: SpeedMode;
  private intensity: number;
  private cancelTick: (() => void) | null = null;
  private starting = false;
  private lastTickMs = 0;
  private startedAtMs = 0;
  private demoStartedAtMs = 0;
  private speedKmh = 0;
  private accelMps2 = 0;
  private load = 0;
  private revHeld = false;
  private revLoad = 0;
  private gasHeld = false;
  private brakeHeld = false;
  private gasLevel = 0;
  private brakeLevel = 0;
  private testSpeedKmh = 0;
  private rpm = 0;
  private drivetrain: DrivetrainState = NEUTRAL;
  private shiftCutUntilMs = 0;

  constructor(options: ControllerOptions) {
    this.sound = options.sound;
    this.gps = options.gps;
    this.profile = options.profile;
    this.mode = options.mode;
    this.intensity = clamp(options.intensity ?? 0.5, 0, 1);
    this.onTelemetry = options.onTelemetry;
    this.now = options.now ?? (() => performance.now());
    this.wallClock = options.wallClock ?? (() => Date.now());
    this.schedule = options.schedule ?? intervalScheduler;
  }

  get running(): boolean {
    return this.cancelTick !== null;
  }

  get telemetry(): Telemetry {
    return {
      running: this.running,
      mode: this.mode,
      speedKmh: this.speedKmh,
      rpm: this.rpm,
      gear: gearLabel(this.drivetrain.gear),
      load: this.load,
      redlineRpm: this.profile.redlineRpm,
      canRev: this.running && this.speedKmh < REV_MAX_SPEED_KMH,
      gps: this.gps.snapshot(this.wallClock()),
      audio: this.sound.snapshot(),
    };
  }

  async start(): Promise<void> {
    if (this.running || this.starting) return;
    this.starting = true;
    try {
      await this.sound.start();
    } finally {
      this.starting = false;
    }
    this.resetMotion(this.now());
    if (this.mode === 'gps') this.gps.start();
    this.cancelTick = this.schedule(() => this.tick(), TICK_MS);
    this.emit();
  }

  async stop(): Promise<void> {
    if (!this.cancelTick) return;
    this.cancelTick();
    this.cancelTick = null;
    this.gps.stop();
    this.revHeld = false;
    this.releasePedals();
    this.resetMotion(this.now());
    this.emit();
    await this.sound.stop();
  }

  setProfile(profile: EngineProfile): void {
    this.profile = profile;
    this.sound.setProfile(profile);
    // Re-engage from neutral so the new gearbox picks a suitable gear for the current speed.
    this.drivetrain = NEUTRAL;
    this.emit();
  }

  setMode(mode: SpeedMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.releasePedals();
    if (this.running) {
      if (mode === 'gps') this.gps.start();
      else this.gps.stop();
      this.demoStartedAtMs = this.now();
      // A test drive continues from the current speed instead of stopping dead.
      this.testSpeedKmh = this.speedKmh;
    }
    this.emit();
  }

  setIntensity(intensity: number): void {
    this.intensity = clamp(intensity, 0, 1);
  }

  setRev(held: boolean): void {
    this.revHeld = held;
  }

  /** Test-drive pedals; ignored in the other modes. */
  setPedal(pedal: Pedal, pressed: boolean): void {
    if (pedal === 'gas') this.gasHeld = pressed;
    else this.brakeHeld = pressed;
  }

  private releasePedals(): void {
    this.gasHeld = false;
    this.brakeHeld = false;
  }

  private resetMotion(nowMs: number): void {
    this.lastTickMs = nowMs;
    this.startedAtMs = nowMs;
    this.demoStartedAtMs = nowMs;
    this.speedKmh = 0;
    this.accelMps2 = 0;
    this.load = 0;
    this.revLoad = 0;
    this.gasLevel = 0;
    this.brakeLevel = 0;
    this.testSpeedKmh = 0;
    this.rpm = 0;
    this.drivetrain = NEUTRAL;
    this.shiftCutUntilMs = 0;
  }

  private targetSpeedKmh(nowMs: number): number {
    if (this.mode === 'gps') return this.gps.speedKmh(this.wallClock());
    if (this.mode === 'test') return this.testSpeedKmh;
    return demoSpeedKmh((nowMs - this.demoStartedAtMs) / 1000);
  }

  private tick(): void {
    const nowMs = this.now();
    const dtS = Math.min(0.2, Math.max(0.001, (nowMs - this.lastTickMs) / 1000));
    this.lastTickMs = nowMs;
    const profile = this.profile;

    const testing = this.mode === 'test';
    this.gasLevel = approach(this.gasLevel, testing && this.gasHeld ? 1 : 0, dtS, 2.5, 6);
    this.brakeLevel = approach(this.brakeLevel, testing && this.brakeHeld ? 1 : 0, dtS, 4, 8);
    if (testing) {
      const pedals = { gas: this.gasLevel, brake: this.brakeLevel };
      this.testSpeedKmh = stepTestDrive(this.testSpeedKmh, pedals, dtS);
    }

    const previousSpeed = this.speedKmh;
    const target = this.targetSpeedKmh(nowMs);
    this.speedKmh = smoothToward(previousSpeed, target, dtS, SPEED_SMOOTHING_S[this.mode]);
    const accel = (this.speedKmh - previousSpeed) / 3.6 / dtS;
    this.accelMps2 = smoothToward(this.accelMps2, accel, dtS, 0.4);

    const canRev = this.speedKmh < REV_MAX_SPEED_KMH;
    this.revLoad = approach(this.revLoad, this.revHeld && canRev ? 1 : 0, dtS, 6, 4);
    const demand = Math.max(
      estimateLoad(this.accelMps2, this.speedKmh, this.intensity),
      this.revLoad,
      this.gasLevel,
    );
    this.load = smoothToward(this.load, demand, dtS, 0.12);

    const previousGear = this.drivetrain.gear;
    this.drivetrain = stepDrivetrain(profile, this.drivetrain, {
      speedKmh: this.speedKmh,
      load: this.load,
      nowMs,
    });
    if (previousGear > 0 && this.drivetrain.gear > previousGear) {
      this.shiftCutUntilMs = nowMs + SHIFT_CUT_MS;
    }
    const shifting = nowMs < this.shiftCutUntilMs;

    let targetRpm = this.drivetrain.targetRpm;
    const sinceStartS = (nowMs - this.startedAtMs) / 1000;
    if (this.drivetrain.gear === 0 && sinceStartS < STARTUP_DURATION_S) {
      targetRpm = Math.max(targetRpm, startupFlareRpm(profile, sinceStartS));
    }

    this.rpm = approach(this.rpm, targetRpm, dtS, 2500 + 6500 * this.load, shifting ? 12000 : 3500);
    if (this.rpm >= profile.redlineRpm) this.rpm = profile.redlineRpm - LIMITER_DROP_RPM;

    this.sound.update(this.rpm, shifting ? this.load * 0.15 : this.load);
    this.emit();
  }

  private emit(): void {
    this.onTelemetry(this.telemetry);
  }
}
