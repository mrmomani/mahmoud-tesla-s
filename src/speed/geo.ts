import { clamp } from '../util/math';

export interface Fix {
  readonly latitude: number;
  readonly longitude: number;
  readonly accuracyM: number;
  /** Ground speed reported by the device; browsers report null when it is unknown. */
  readonly speedMps: number | null;
  readonly timestampMs: number;
}

/** Where the current speed came from: the device's own measurement or distance over time. */
export type SpeedSourceKind = 'none' | 'device' | 'derived';

export interface SpeedEstimatorOptions {
  /** Fixes less precise than this are not used to derive speed from distance travelled. */
  readonly maxAccuracyM: number;
  /** How far back to look for a reference fix when deriving speed. */
  readonly windowMs: number;
  /** Shortest time span used for derived speed; shorter spans amplify GPS jitter. */
  readonly minBaselineMs: number;
  readonly reportedDeadbandKmh: number;
  readonly derivedDeadbandKmh: number;
  readonly maxKmh: number;
  /** How far ahead the speed trend is projected while waiting for the next fix. */
  readonly maxExtrapolationMs: number;
  /** After this long without a fix the last speed starts fading out. */
  readonly staleAfterMs: number;
  readonly fadeMs: number;
}

export const DEFAULT_SPEED_OPTIONS: SpeedEstimatorOptions = {
  maxAccuracyM: 50,
  windowMs: 4000,
  minBaselineMs: 2000,
  reportedDeadbandKmh: 1,
  derivedDeadbandKmh: 3,
  maxKmh: 300,
  maxExtrapolationMs: 1500,
  staleAfterMs: 4000,
  fadeMs: 6000,
};

const EARTH_RADIUS_M = 6_371_008.8;
/** Projects slightly less than the measured trend so a sudden lift-off does not overshoot much. */
const EXTRAPOLATION_GAIN = 0.8;
/** Roughly 1.1 g, beyond the strongest acceleration or braking a road car manages. */
const MAX_TREND_KMH_PER_S = 40;

type Point = Pick<Fix, 'latitude' | 'longitude'>;

export function haversineMeters(a: Point, b: Point): number {
  const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;
  const dLat = toRadians(b.latitude - a.latitude);
  const dLon = toRadians(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(a.latitude)) * Math.cos(toRadians(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Turns a stream of GPS fixes into a speed. Prefers the device-reported speed and falls back
 * to distance over time, filtering inaccurate fixes, jitter while parked, and impossible spikes.
 * Between fixes it projects the recent speed trend forward, so the engine does not lag a whole
 * GPS interval behind the car.
 */
export class SpeedEstimator {
  private readonly options: SpeedEstimatorOptions;
  private history: Fix[] = [];
  private speed = 0;
  private speedAtMs: number | null = null;
  private trendKmhPerS = 0;
  private lastFixMs: number | null = null;
  private fixIntervalMs: number | null = null;
  private accuracy: number | null = null;
  private kind: SpeedSourceKind = 'none';

  constructor(options: Partial<SpeedEstimatorOptions> = {}) {
    this.options = { ...DEFAULT_SPEED_OPTIONS, ...options };
  }

  get accuracyM(): number | null {
    return this.accuracy;
  }

  get source(): SpeedSourceKind {
    return this.kind;
  }

  /** Average number of fixes per second, once at least two fixes have arrived. */
  get updateHz(): number | null {
    return this.fixIntervalMs === null ? null : 1000 / this.fixIntervalMs;
  }

  reset(): void {
    this.history = [];
    this.speed = 0;
    this.speedAtMs = null;
    this.trendKmhPerS = 0;
    this.lastFixMs = null;
    this.fixIntervalMs = null;
    this.accuracy = null;
    this.kind = 'none';
  }

  update(fix: Fix): void {
    if (this.lastFixMs !== null) {
      const gapMs = fix.timestampMs - this.lastFixMs;
      if (gapMs > 0 && gapMs < 10_000) {
        this.fixIntervalMs =
          this.fixIntervalMs === null
            ? gapMs
            : this.fixIntervalMs + (gapMs - this.fixIntervalMs) * 0.3;
      }
    }
    this.lastFixMs = fix.timestampMs;
    this.accuracy = fix.accuracyM;
    const accurate = fix.accuracyM <= this.options.maxAccuracyM;
    if (accurate) this.remember(fix);

    const reported = fix.speedMps;
    if (reported !== null && Number.isFinite(reported) && reported >= 0) {
      this.accept(reported * 3.6, this.options.reportedDeadbandKmh, fix.timestampMs, 'device');
      return;
    }
    if (!accurate) return;

    const reference = this.history[0];
    if (!reference) return;
    const baselineMs = fix.timestampMs - reference.timestampMs;
    if (baselineMs < this.options.minBaselineMs) return;
    const kmh = (haversineMeters(reference, fix) / (baselineMs / 1000)) * 3.6;
    this.accept(kmh, this.options.derivedDeadbandKmh, fix.timestampMs, 'derived');
  }

  speedKmh(nowMs: number): number {
    if (this.lastFixMs === null || this.speedAtMs === null) return 0;
    const ageMs = nowMs - this.lastFixMs;
    if (ageMs > this.options.staleAfterMs) {
      const remaining = 1 - (ageMs - this.options.staleAfterMs) / this.options.fadeMs;
      return this.speed * Math.max(0, remaining);
    }
    const aheadS = clamp(nowMs - this.speedAtMs, 0, this.options.maxExtrapolationMs) / 1000;
    const projected = this.speed + this.trendKmhPerS * aheadS * EXTRAPOLATION_GAIN;
    return clamp(projected, 0, this.options.maxKmh);
  }

  isStale(nowMs: number): boolean {
    return this.lastFixMs !== null && nowMs - this.lastFixMs > this.options.staleAfterMs;
  }

  fixAgeMs(nowMs: number): number | null {
    return this.lastFixMs === null ? null : Math.max(0, nowMs - this.lastFixMs);
  }

  private remember(fix: Fix): void {
    const oldestMs = fix.timestampMs - this.options.windowMs;
    this.history = [...this.history.filter((entry) => entry.timestampMs >= oldestMs), fix];
  }

  private accept(kmh: number, deadbandKmh: number, atMs: number, kind: SpeedSourceKind): void {
    if (!Number.isFinite(kmh) || kmh > this.options.maxKmh) return;
    const next = kmh < deadbandKmh ? 0 : kmh;
    if (this.speedAtMs !== null) {
      const dtS = (atMs - this.speedAtMs) / 1000;
      if (dtS >= 0.2 && dtS <= 3) {
        const trend = (next - this.speed) / dtS;
        this.trendKmhPerS += (trend - this.trendKmhPerS) * 0.5;
      }
    }
    this.trendKmhPerS =
      next === 0 ? 0 : clamp(this.trendKmhPerS, -MAX_TREND_KMH_PER_S, MAX_TREND_KMH_PER_S);
    this.speed = next;
    this.speedAtMs = atMs;
    this.kind = kind;
  }
}
