import { clamp } from '../util/math';

export interface Pedals {
  /** Pedal travel from 0 (released) to 1 (floored). */
  readonly gas: number;
  readonly brake: number;
}

export const TEST_DRIVE_TOP_KMH = 240;
/** Roughly 0-100 km/h in six seconds: quick enough to hear several shifts without waiting. */
const FULL_GAS_MPS2 = 6;
const FULL_BRAKE_MPS2 = 8;
/** Engine braking and rolling resistance when neither pedal is pressed. */
const COAST_MPS2 = 0.5;
const DRAG_PER_MPS_SQUARED = 0.0004;

/** Simple longitudinal physics for driving the engine with on-screen pedals while parked. */
export function stepTestDrive(speedKmh: number, pedals: Pedals, dtS: number): number {
  const gas = clamp(pedals.gas, 0, 1);
  const brake = clamp(pedals.brake, 0, 1);
  const speedMps = speedKmh / 3.6;
  const drive = gas * FULL_GAS_MPS2 * Math.max(0, 1 - speedKmh / TEST_DRIVE_TOP_KMH);
  const drag = DRAG_PER_MPS_SQUARED * speedMps * speedMps;
  const coast = gas > 0 ? 0 : COAST_MPS2;
  const accelMps2 = drive - drag - coast - brake * FULL_BRAKE_MPS2;
  return clamp(speedKmh + accelMps2 * 3.6 * dtS, 0, TEST_DRIVE_TOP_KMH);
}
