import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_PROFILE } from '../engine/profiles';
import type { GpsSource } from '../speed/gpsSource';
import { EngineController, type SpeedMode, type Telemetry } from './controller';

const TICK_MS = 40;

function setup(mode: SpeedMode, gpsSpeedKmh = 0) {
  let nowMs = 0;
  let tick: (() => void) | null = null;
  const frames: Telemetry[] = [];
  const gps: GpsSource = {
    start: vi.fn(),
    stop: vi.fn(),
    speedKmh: () => gpsSpeedKmh,
    snapshot: () => ({
      status: 'active',
      accuracyM: 5,
      stale: false,
      updateHz: 1,
      fixAgeMs: 200,
      source: 'device',
      fixes: { live: 1, fallback: 0 },
      reportedKmh: gpsSpeedKmh,
      derivedKmh: null,
      clockOffsetMs: 0,
      lastError: null,
    }),
  };
  const controller = new EngineController({
    sound: {
      start: vi.fn(async () => {}),
      stop: vi.fn(async () => {}),
      update: vi.fn(),
      setProfile: vi.fn(),
      snapshot: () => ({ state: 'running', latencyMs: 20, sampleRate: 48000, background: 'off' }),
    },
    gps,
    profile: DEFAULT_PROFILE,
    mode,
    onTelemetry: (telemetry) => frames.push(telemetry),
    now: () => nowMs,
    wallClock: () => nowMs,
    schedule: (callback) => {
      tick = callback;
      return () => {
        tick = null;
      };
    },
  });

  return {
    controller,
    gps,
    frames,
    advance(ms: number): void {
      for (let elapsed = 0; elapsed < ms; elapsed += TICK_MS) {
        nowMs += TICK_MS;
        tick?.();
      }
    },
    latest(): Telemetry {
      const frame = frames.at(-1);
      if (!frame) throw new Error('No telemetry yet');
      return frame;
    },
  };
}

describe('EngineController', () => {
  it('bounces off the limiter while revving parked, without passing the redline', async () => {
    const car = setup('gps', 0);
    await car.controller.start();
    car.advance(2000);
    car.controller.setRev(true);
    car.frames.length = 0;
    car.advance(3000);

    const revs = car.frames.map((frame) => frame.rpm);
    expect(car.latest().gear).toBe('N');
    expect(Math.max(...revs)).toBeGreaterThan(DEFAULT_PROFILE.redlineRpm * 0.9);
    expect(Math.max(...revs)).toBeLessThan(DEFAULT_PROFILE.redlineRpm);
    expect(new Set(revs.slice(-10).map(Math.round)).size).toBeGreaterThan(1);
  });

  it('only allows revving while the car is stopped', async () => {
    const parked = setup('gps', 0);
    await parked.controller.start();
    parked.advance(500);
    expect(parked.latest().canRev).toBe(true);

    const moving = setup('gps', 60);
    await moving.controller.start();
    moving.advance(5000);
    expect(moving.latest().canRev).toBe(false);
    expect(moving.latest().gear).not.toBe('N');
  });

  it('uses GPS only while the engine runs in GPS mode', async () => {
    const gpsCar = setup('gps');
    await gpsCar.controller.start();
    expect(gpsCar.gps.start).toHaveBeenCalledTimes(1);
    await gpsCar.controller.stop();
    expect(gpsCar.gps.stop).toHaveBeenCalled();
    expect(gpsCar.latest().running).toBe(false);

    const demoCar = setup('demo');
    await demoCar.controller.start();
    expect(demoCar.gps.start).not.toHaveBeenCalled();
  });

  it('drives up through the gears on the test-drive pedals and brakes to a stop', async () => {
    const car = setup('test');
    await car.controller.start();
    car.advance(1500);
    car.controller.setPedal('gas', true);
    car.advance(8000);
    expect(car.latest().speedKmh).toBeGreaterThan(60);
    expect(Number(car.latest().gear)).toBeGreaterThanOrEqual(2);

    car.controller.setPedal('gas', false);
    car.controller.setPedal('brake', true);
    car.advance(6000);
    expect(car.latest().speedKmh).toBeLessThan(1);
    expect(car.latest().gear).toBe('N');
  });

  it('ignores the pedals outside test-drive mode', async () => {
    const car = setup('gps', 0);
    await car.controller.start();
    car.controller.setPedal('gas', true);
    car.advance(3000);
    expect(car.latest().speedKmh).toBe(0);
  });
});
