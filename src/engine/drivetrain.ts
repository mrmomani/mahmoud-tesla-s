import { clamp, lerp } from '../util/math';
import type { EngineProfile } from './profiles';

/** Below this speed the car counts as stopped and the engine idles in neutral. */
export const NEUTRAL_BELOW_KMH = 2;
export const MIN_SHIFT_INTERVAL_MS = 700;
export const STARTUP_DURATION_S = 1.4;
const LAUNCH_SLIP_KMH = 25;

export interface DrivetrainState {
  /** 0 is neutral; 1..n are the forward gears. */
  readonly gear: number;
  readonly targetRpm: number;
  readonly lastShiftMs: number;
}

export interface DrivetrainInput {
  readonly speedKmh: number;
  /** Throttle demand from 0 (lift-off) to 1 (full throttle). */
  readonly load: number;
  readonly nowMs: number;
}

export const NEUTRAL: DrivetrainState = {
  gear: 0,
  targetRpm: 0,
  lastShiftMs: Number.NEGATIVE_INFINITY,
};

export function wheelRpm(speedKmh: number, wheelRadiusM: number): number {
  const metersPerSecond = speedKmh / 3.6;
  return (metersPerSecond / (2 * Math.PI * wheelRadiusM)) * 60;
}

export function rpmInGear(profile: EngineProfile, speedKmh: number, gear: number): number {
  const { gearRatios, finalDrive, wheelRadiusM } = profile.transmission;
  const ratio = gearRatios[gear - 1];
  if (ratio === undefined) return profile.idleRpm;
  return wheelRpm(speedKmh, wheelRadiusM) * ratio * finalDrive;
}

/** Shift points move toward the redline as the driver asks for more power. */
export function shiftPoints(profile: EngineProfile, load: number): { up: number; down: number } {
  const t = clamp(load, 0, 1);
  return {
    up: lerp(Math.max(profile.idleRpm * 3, 2300), profile.redlineRpm * 0.9, t),
    down: lerp(profile.idleRpm * 1.4, profile.redlineRpm * 0.42, t),
  };
}

/** The lowest gear that keeps the engine below its upshift point at this speed. */
export function selectGear(profile: EngineProfile, speedKmh: number, load: number): number {
  const gearCount = profile.transmission.gearRatios.length;
  const { up } = shiftPoints(profile, load);
  for (let gear = 1; gear < gearCount; gear++) {
    if (rpmInGear(profile, speedKmh, gear) <= up) return gear;
  }
  return gearCount;
}

/** Target revs in neutral. Full throttle aims past the redline so the limiter can bounce off it. */
export function freeRevRpm(profile: EngineProfile, load: number): number {
  return lerp(profile.idleRpm, profile.redlineRpm + 300, clamp(load, 0, 1));
}

export function stepDrivetrain(
  profile: EngineProfile,
  state: DrivetrainState,
  input: DrivetrainInput,
): DrivetrainState {
  const load = clamp(input.load, 0, 1);
  const { speedKmh, nowMs } = input;

  if (speedKmh < NEUTRAL_BELOW_KMH) {
    return { gear: 0, targetRpm: freeRevRpm(profile, load), lastShiftMs: state.lastShiftMs };
  }

  const gearCount = profile.transmission.gearRatios.length;
  const engaging = state.gear === 0;
  let gear = engaging ? selectGear(profile, speedKmh, load) : clamp(state.gear, 1, gearCount);
  let lastShiftMs = engaging ? nowMs : state.lastShiftMs;

  if (!engaging && nowMs - lastShiftMs >= MIN_SHIFT_INTERVAL_MS) {
    const { up, down } = shiftPoints(profile, load);
    const rpm = rpmInGear(profile, speedKmh, gear);
    if (rpm > up && gear < gearCount) {
      gear += 1;
      lastShiftMs = nowMs;
    } else if (rpm < down && gear > 1) {
      gear -= 1;
      lastShiftMs = nowMs;
    }
  }

  // Pulling away slips the clutch, so revs rise with throttle before the wheels catch up.
  const slip = clamp(1 - speedKmh / LAUNCH_SLIP_KMH, 0, 1);
  const launchRpm = profile.idleRpm + load * profile.redlineRpm * 0.3 * slip;
  const inGearRpm = rpmInGear(profile, speedKmh, gear);
  const targetRpm = clamp(
    Math.max(inGearRpm, launchRpm, profile.idleRpm),
    profile.idleRpm,
    profile.redlineRpm,
  );
  return { gear, targetRpm, lastShiftMs };
}

/**
 * Estimates throttle demand from acceleration; lifting off or braking reads as zero load.
 * `intensity` (0..1) sets how eagerly acceleration becomes throttle, which also delays upshifts.
 */
export function estimateLoad(accelMps2: number, speedKmh: number, intensity = 0.5): number {
  const cruise = speedKmh < NEUTRAL_BELOW_KMH ? 0 : 0.12 + Math.min(speedKmh / 250, 0.3);
  const fullThrottleMps2 = lerp(4.5, 1.5, clamp(intensity, 0, 1));
  if (accelMps2 >= 0) return clamp(cruise + accelMps2 / fullThrottleMps2, 0, 1);
  return clamp(cruise * (1 + accelMps2 / 0.6), 0, 1);
}

/** Cranking, then the brief flare an engine makes when it fires up. */
export function startupFlareRpm(profile: EngineProfile, elapsedS: number): number {
  const peakS = 0.45;
  const crankRpm = profile.idleRpm * 0.3;
  const peakRpm = profile.idleRpm * 1.8;
  if (elapsedS <= 0) return crankRpm;
  if (elapsedS < peakS) return lerp(crankRpm, peakRpm, elapsedS / peakS);
  return lerp(
    peakRpm,
    profile.idleRpm,
    clamp((elapsedS - peakS) / (STARTUP_DURATION_S - peakS), 0, 1),
  );
}

export function gearLabel(gear: number): string {
  return gear <= 0 ? 'N' : String(gear);
}
