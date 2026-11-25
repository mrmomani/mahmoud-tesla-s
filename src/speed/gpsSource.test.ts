import { describe, expect, it, vi } from 'vitest';
import { GpsSpeedSource } from './gpsSource';

const WATCH_ID = 42;
/** A wall-clock time in late 2026. */
const START_MS = 1_795_000_000_000;

function position(speedMps: number | null, timestampMs: number): GeolocationPosition {
  return {
    coords: { latitude: 31.95, longitude: 35.91, accuracy: 5, speed: speedMps },
    timestamp: timestampMs,
  } as unknown as GeolocationPosition;
}

function setup(overrides: Partial<Geolocation> = {}, secureContext = true) {
  let nowMs = START_MS;
  let tick: (() => void) | null = null;
  let watchSuccess: PositionCallback | undefined;
  let watchError: PositionErrorCallback | null | undefined;
  let requests: { success: PositionCallback; error?: PositionErrorCallback | null | undefined }[] =
    [];
  const geolocation = {
    watchPosition: vi.fn((success: PositionCallback, error?: PositionErrorCallback | null) => {
      watchSuccess = success;
      watchError = error;
      return WATCH_ID;
    }),
    clearWatch: vi.fn(),
    getCurrentPosition: vi.fn(
      (success: PositionCallback, error?: PositionErrorCallback | null): void => {
        requests.push({ success, error });
      },
    ),
    ...overrides,
  };
  const source = new GpsSpeedSource({
    geolocation: geolocation as unknown as Geolocation,
    secureContext,
    now: () => nowMs,
    schedule: (callback) => {
      tick = callback;
      return () => {
        tick = null;
      };
    },
  });

  return {
    source,
    geolocation,
    get nowMs(): number {
      return nowMs;
    },
    /** Lets time pass in one-second steps, running the fallback timer each step. */
    wait(ms: number): void {
      for (let elapsed = 0; elapsed < ms; elapsed += 1000) {
        nowMs += 1000;
        tick?.();
      }
    },
    live(speedMps: number | null, browserTimestampMs = nowMs): void {
      watchSuccess?.(position(speedMps, browserTimestampMs));
    },
    answerRequests(speedMps: number | null): void {
      const answered = requests;
      requests = [];
      for (const request of answered) request.success(position(speedMps, nowMs));
    },
    failLive(code: number, message = 'test'): void {
      watchError?.({ code, message } as unknown as GeolocationPositionError);
    },
  };
}

describe('GpsSpeedSource', () => {
  it('does not ask for location on an insecure page', () => {
    const gps = setup({}, false);
    gps.source.start();
    expect(gps.source.snapshot(gps.nowMs).status).toBe('insecure');
    expect(gps.geolocation.watchPosition).not.toHaveBeenCalled();
  });

  it('turns live position updates into a speed', () => {
    const gps = setup();
    gps.source.start();
    expect(gps.source.snapshot(gps.nowMs).status).toBe('waiting');
    gps.live(20);
    expect(gps.source.snapshot(gps.nowMs).status).toBe('active');
    expect(gps.source.speedKmh(gps.nowMs)).toBeCloseTo(72);
  });

  it('stamps fixes on arrival, so a browser clock from another time base cannot stall them', () => {
    const gps = setup();
    gps.source.start();
    // A timestamp counted from when the car's computer booted, not from 1970.
    gps.live(20, 5_000);
    const snapshot = gps.source.snapshot(gps.nowMs);
    expect(snapshot.stale).toBe(false);
    expect(snapshot.clockOffsetMs).toBe(5_000 - START_MS);
    expect(gps.source.speedKmh(gps.nowMs)).toBeCloseTo(72);
  });

  it('asks for the position directly only while the live watch is quiet', () => {
    const gps = setup();
    gps.source.start();
    gps.live(20);
    for (let second = 0; second < 5; second++) {
      gps.wait(1000);
      gps.live(20);
    }
    expect(gps.geolocation.getCurrentPosition).not.toHaveBeenCalled();

    gps.wait(2000);
    expect(gps.geolocation.getCurrentPosition).toHaveBeenCalledTimes(1);
    gps.answerRequests(15);
    expect(gps.source.speedKmh(gps.nowMs)).toBeCloseTo(54);
    expect(gps.source.snapshot(gps.nowMs).fixes).toEqual({ live: 6, fallback: 1 });
  });

  it('keeps going on the fallback when the browser throws on watchPosition', () => {
    const gps = setup({
      watchPosition: vi.fn(() => {
        throw new Error('Not supported here');
      }),
    });
    expect(() => gps.source.start()).not.toThrow();
    expect(gps.source.snapshot(gps.nowMs).lastError).toBe('Not supported here');

    gps.wait(1000);
    gps.answerRequests(10);
    expect(gps.source.snapshot(gps.nowMs).status).toBe('active');
    expect(gps.source.speedKmh(gps.nowMs)).toBeCloseTo(36);
  });

  it('stops everything when location permission is denied', () => {
    const gps = setup();
    gps.source.start();
    gps.failLive(1, 'User denied Geolocation');
    const snapshot = gps.source.snapshot(gps.nowMs);
    expect(snapshot.status).toBe('denied');
    expect(snapshot.lastError).toBe('Permission denied: User denied Geolocation');
    expect(gps.geolocation.clearWatch).toHaveBeenCalledWith(WATCH_ID);
    gps.wait(3000);
    expect(gps.geolocation.getCurrentPosition).not.toHaveBeenCalled();
  });

  it('ignores answers that arrive after GPS was switched off', () => {
    const gps = setup();
    gps.source.start();
    gps.wait(1000);
    gps.source.stop();
    gps.answerRequests(20);
    const snapshot = gps.source.snapshot(gps.nowMs);
    expect(snapshot.status).toBe('off');
    expect(snapshot.fixes).toEqual({ live: 0, fallback: 0 });
  });
});
