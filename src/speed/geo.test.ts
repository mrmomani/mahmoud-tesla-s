import { describe, expect, it } from 'vitest';
import { type Fix, haversineMeters, SpeedEstimator } from './geo';

const METERS_PER_DEGREE_LATITUDE = 111_195;

function fix(overrides: Partial<Fix> & Pick<Fix, 'timestampMs'>): Fix {
  return { latitude: 31.95, longitude: 35.91, accuracyM: 5, speedMps: null, ...overrides };
}

/** Feeds one fix per second, moving north by `metersPerSecond`. */
function driveNorth(
  estimator: SpeedEstimator,
  metersPerSecond: number,
  accuracyM: number | null = 5,
): void {
  const stepDegrees = metersPerSecond / METERS_PER_DEGREE_LATITUDE;
  for (let second = 0; second <= 3; second++) {
    estimator.update(
      fix({ timestampMs: second * 1000, latitude: 31.95 + second * stepDegrees, accuracyM }),
    );
  }
}

describe('haversineMeters', () => {
  it('measures one degree of latitude as about 111 km', () => {
    const meters = haversineMeters({ latitude: 0, longitude: 0 }, { latitude: 1, longitude: 0 });
    expect(meters).toBeCloseTo(METERS_PER_DEGREE_LATITUDE, -2);
  });
});

describe('SpeedEstimator', () => {
  it('uses the speed reported by the device', () => {
    const estimator = new SpeedEstimator();
    estimator.update(fix({ timestampMs: 1000, speedMps: 20 }));
    expect(estimator.speedKmh(1000)).toBeCloseTo(72);
  });

  it('derives speed from distance travelled when the device reports none', () => {
    const estimator = new SpeedEstimator();
    driveNorth(estimator, 25);
    expect(estimator.speedKmh(3000)).toBeCloseTo(90, 0);
    expect(estimator.source).toBe('derived');
  });

  it('treats GPS jitter while parked as standing still', () => {
    const estimator = new SpeedEstimator();
    const jitterDegrees = 1 / METERS_PER_DEGREE_LATITUDE;
    for (let second = 0; second <= 3; second++) {
      estimator.update(
        fix({ timestampMs: second * 1000, latitude: 31.95 + (second % 2) * jitterDegrees }),
      );
    }
    expect(estimator.speedKmh(3000)).toBe(0);
  });

  it('ignores fixes that are too inaccurate to trust', () => {
    const estimator = new SpeedEstimator();
    driveNorth(estimator, 25, 200);
    expect(estimator.speedKmh(3000)).toBe(0);
  });

  it('derives speed from positions that come without an accuracy estimate', () => {
    const estimator = new SpeedEstimator();
    driveNorth(estimator, 25, null);
    expect(estimator.speedKmh(3000)).toBeCloseTo(90, 0);
  });

  it('trusts clear movement over a reported standstill', () => {
    const estimator = new SpeedEstimator();
    const stepDegrees = 25 / METERS_PER_DEGREE_LATITUDE;
    for (let second = 0; second <= 3; second++) {
      estimator.update(
        fix({ timestampMs: second * 1000, latitude: 31.95 + second * stepDegrees, speedMps: 0 }),
      );
    }
    expect(estimator.speedKmh(3000)).toBeCloseTo(90, 0);
    expect(estimator.source).toBe('derived');
    expect(estimator.lastReportedKmh).toBe(0);
  });

  it('keeps a reported standstill when only GPS jitter moves the position', () => {
    const estimator = new SpeedEstimator();
    const jitterDegrees = 3 / METERS_PER_DEGREE_LATITUDE;
    for (let second = 0; second <= 3; second++) {
      estimator.update(
        fix({
          timestampMs: second * 1000,
          latitude: 31.95 + (second % 2) * jitterDegrees,
          speedMps: 0,
        }),
      );
    }
    expect(estimator.speedKmh(3000)).toBe(0);
    expect(estimator.source).toBe('device');
  });

  it('rejects impossible speed spikes', () => {
    const estimator = new SpeedEstimator();
    estimator.update(fix({ timestampMs: 0, speedMps: 15 }));
    estimator.update(fix({ timestampMs: 1000, speedMps: 400 }));
    expect(estimator.speedKmh(1000)).toBeCloseTo(54);
  });

  it('fades the last speed out once the signal goes stale', () => {
    const estimator = new SpeedEstimator({ staleAfterMs: 4000, fadeMs: 6000 });
    estimator.update(fix({ timestampMs: 0, speedMps: 50 / 3.6 }));
    expect(estimator.speedKmh(4000)).toBeCloseTo(50);
    expect(estimator.isStale(4000)).toBe(false);
    expect(estimator.speedKmh(7000)).toBeCloseTo(25);
    expect(estimator.isStale(7000)).toBe(true);
    expect(estimator.speedKmh(20_000)).toBe(0);
  });

  describe('between fixes', () => {
    /** Accelerates at 2 m/s² (7.2 km/h per second) with one fix per second, ending at 57.6 km/h. */
    function accelerate(): SpeedEstimator {
      const estimator = new SpeedEstimator();
      for (let second = 0; second <= 3; second++) {
        estimator.update(fix({ timestampMs: second * 1000, speedMps: 10 + 2 * second }));
      }
      return estimator;
    }

    it('projects the speed trend forward without overshooting the real speed', () => {
      const halfwayKmh = accelerate().speedKmh(3500);
      expect(halfwayKmh).toBeGreaterThan(57.6);
      expect(halfwayKmh).toBeLessThan(57.6 + 7.2 * 0.5);
    });

    it('stops projecting after a short horizon', () => {
      const estimator = accelerate();
      expect(estimator.speedKmh(6000)).toBeCloseTo(estimator.speedKmh(4500));
    });
  });

  it('reports how often fixes arrive and where the speed comes from', () => {
    const estimator = new SpeedEstimator();
    expect(estimator.updateHz).toBeNull();
    expect(estimator.source).toBe('none');
    for (let i = 0; i <= 4; i++) estimator.update(fix({ timestampMs: i * 500, speedMps: 10 }));
    expect(estimator.updateHz).toBeCloseTo(2);
    expect(estimator.source).toBe('device');
    expect(estimator.fixAgeMs(2300)).toBe(300);
  });
});
