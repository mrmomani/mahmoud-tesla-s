import { describe, expect, it, vi } from 'vitest';
import { GpsSpeedSource } from './gpsSource';

const WATCH_ID = 42;

function fakeGeolocation() {
  let onPosition: PositionCallback | undefined;
  let onError: PositionErrorCallback | null | undefined;
  const watchPosition = vi.fn(
    (success: PositionCallback, error?: PositionErrorCallback | null): number => {
      onPosition = success;
      onError = error;
      return WATCH_ID;
    },
  );
  const clearWatch = vi.fn();
  return {
    geolocation: {
      watchPosition,
      clearWatch,
      getCurrentPosition: vi.fn(),
    } as unknown as Geolocation,
    watchPosition,
    clearWatch,
    move(speedMps: number, timestampMs: number): void {
      onPosition?.({
        coords: { latitude: 31.95, longitude: 35.91, accuracy: 5, speed: speedMps },
        timestamp: timestampMs,
      } as unknown as GeolocationPosition);
    },
    fail(code: number): void {
      onError?.({ code, message: 'test' } as unknown as GeolocationPositionError);
    },
  };
}

describe('GpsSpeedSource', () => {
  it('does not ask for location on an insecure page', () => {
    const fake = fakeGeolocation();
    const source = new GpsSpeedSource(fake.geolocation, false);
    source.start();
    expect(source.snapshot(0).status).toBe('insecure');
    expect(fake.watchPosition).not.toHaveBeenCalled();
  });

  it('turns position updates into a speed', () => {
    const fake = fakeGeolocation();
    const source = new GpsSpeedSource(fake.geolocation, true);
    source.start();
    expect(source.snapshot(0).status).toBe('waiting');
    fake.move(20, 1000);
    expect(source.snapshot(1000).status).toBe('active');
    expect(source.speedKmh(1000)).toBeCloseTo(72);
  });

  it('stops watching when location permission is denied', () => {
    const fake = fakeGeolocation();
    const source = new GpsSpeedSource(fake.geolocation, true);
    source.start();
    fake.fail(1);
    expect(source.snapshot(0).status).toBe('denied');
    expect(fake.clearWatch).toHaveBeenCalledWith(WATCH_ID);
  });
});
