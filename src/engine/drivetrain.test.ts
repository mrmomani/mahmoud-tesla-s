import { describe, expect, it } from 'vitest';
import {
  estimateLoad,
  MIN_SHIFT_INTERVAL_MS,
  NEUTRAL,
  rpmInGear,
  STARTUP_DURATION_S,
  shiftPoints,
  startupFlareRpm,
  stepDrivetrain,
  wheelRpm,
} from './drivetrain';
import { DEFAULT_PROFILE, type EngineProfile, PROFILES } from './profiles';

const v8 = DEFAULT_PROFILE;

/** Accelerates steadily from walking pace and returns the engine rpm at the first upshift. */
function firstUpshiftRpm(profile: EngineProfile, load: number): number {
  let state = stepDrivetrain(profile, NEUTRAL, { speedKmh: 3, load, nowMs: 0 });
  for (let nowMs = 50; nowMs < 20_000; nowMs += 50) {
    const speedKmh = 3 + nowMs / 100;
    const next = stepDrivetrain(profile, state, { speedKmh, load, nowMs });
    if (next.gear > state.gear) return rpmInGear(profile, speedKmh, state.gear);
    state = next;
  }
  throw new Error('Never upshifted');
}

describe('drivetrain', () => {
  it('converts road speed to wheel revolutions', () => {
    // 100 km/h on a 0.33 m wheel is about 804 revolutions per minute.
    expect(wheelRpm(100, 0.33)).toBeCloseTo(803.8, 0);
  });

  it('idles in neutral while stopped', () => {
    const state = stepDrivetrain(v8, NEUTRAL, { speedKmh: 0, load: 0, nowMs: 0 });
    expect(state.gear).toBe(0);
    expect(state.targetRpm).toBe(v8.idleRpm);
  });

  it('picks a cruising gear when it engages while already moving', () => {
    const state = stepDrivetrain(v8, NEUTRAL, { speedKmh: 100, load: 0.2, nowMs: 0 });
    const { up, down } = shiftPoints(v8, 0.2);
    expect(state.gear).toBeGreaterThan(1);
    expect(state.targetRpm).toBeLessThanOrEqual(up);
    expect(state.targetRpm).toBeGreaterThanOrEqual(down);
  });

  it('waits between shifts so the gearbox does not hunt', () => {
    const cruising = stepDrivetrain(v8, NEUTRAL, { speedKmh: 30, load: 0.2, nowMs: 0 });
    const tooSoon = stepDrivetrain(v8, cruising, {
      speedKmh: 90,
      load: 0.2,
      nowMs: MIN_SHIFT_INTERVAL_MS - 1,
    });
    const later = stepDrivetrain(v8, tooSoon, {
      speedKmh: 90,
      load: 0.2,
      nowMs: MIN_SHIFT_INTERVAL_MS,
    });
    expect(tooSoon.gear).toBe(cruising.gear);
    expect(later.gear).toBe(cruising.gear + 1);
  });

  it('holds each gear longer under full throttle than when cruising', () => {
    expect(firstUpshiftRpm(v8, 1)).toBeGreaterThan(firstUpshiftRpm(v8, 0.2) + 1500);
  });

  it('revs with the throttle while the clutch slips at launch', () => {
    const state = stepDrivetrain(v8, NEUTRAL, { speedKmh: 5, load: 1, nowMs: 0 });
    expect(state.targetRpm).toBeGreaterThan(rpmInGear(v8, 5, 1) + 1000);
  });

  it.each(PROFILES.map((profile) => [profile.name, profile] as const))(
    '%s shifts up through its gearbox without hunting on a full-throttle run',
    (_name, profile) => {
      let state = stepDrivetrain(profile, NEUTRAL, { speedKmh: 3, load: 1, nowMs: 0 });
      for (let nowMs = 50; nowMs <= 40_000; nowMs += 50) {
        const next = stepDrivetrain(profile, state, {
          speedKmh: 3 + (nowMs / 1000) * 7.5,
          load: 1,
          nowMs,
        });
        expect(next.gear).toBeGreaterThanOrEqual(state.gear);
        expect(next.targetRpm).toBeLessThanOrEqual(profile.redlineRpm);
        state = next;
      }
      expect(state.gear).toBeGreaterThanOrEqual(profile.transmission.gearRatios.length - 1);
    },
  );

  it('reads hard acceleration as full throttle and lifting off as no load', () => {
    expect(estimateLoad(4, 60)).toBe(1);
    expect(estimateLoad(-1, 60)).toBe(0);
    expect(estimateLoad(0, 0)).toBe(0);
    expect(estimateLoad(0, 100)).toBeGreaterThan(0);
  });

  it('turns the same acceleration into more throttle at a higher intensity', () => {
    expect(estimateLoad(1, 60, 1)).toBeGreaterThan(estimateLoad(1, 60, 0));
  });

  it('flares above idle when starting and settles back to idle', () => {
    expect(startupFlareRpm(v8, 0)).toBeLessThan(v8.idleRpm);
    expect(startupFlareRpm(v8, 0.45)).toBeGreaterThan(v8.idleRpm * 1.5);
    expect(startupFlareRpm(v8, STARTUP_DURATION_S)).toBe(v8.idleRpm);
  });
});
