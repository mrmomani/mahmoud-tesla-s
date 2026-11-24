import { type Fix, SpeedEstimator, type SpeedSourceKind } from './geo';

export type GpsStatus =
  | 'off'
  | 'waiting'
  | 'active'
  | 'timeout'
  | 'denied'
  | 'unavailable'
  | 'unsupported'
  | 'insecure';

export interface GpsSnapshot {
  readonly status: GpsStatus;
  readonly accuracyM: number | null;
  readonly stale: boolean;
  readonly updateHz: number | null;
  readonly fixAgeMs: number | null;
  readonly source: SpeedSourceKind;
}

export interface GpsSource {
  start(): void;
  stop(): void;
  speedKmh(nowMs: number): number;
  snapshot(nowMs: number): GpsSnapshot;
}

const PERMISSION_DENIED = 1;
const POSITION_UNAVAILABLE = 2;

const WATCH_OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  maximumAge: 0,
  timeout: 15_000,
};

/** Watches the browser's position and exposes the resulting speed. */
export class GpsSpeedSource implements GpsSource {
  private readonly geolocation: Geolocation | undefined;
  private readonly secureContext: boolean;
  private readonly estimator = new SpeedEstimator();
  private watchId: number | null = null;
  private status: GpsStatus = 'off';

  constructor(
    geolocation: Geolocation | undefined = globalThis.navigator?.geolocation,
    secureContext: boolean = globalThis.isSecureContext ?? true,
  ) {
    this.geolocation = geolocation;
    this.secureContext = secureContext;
  }

  start(): void {
    if (this.watchId !== null) return;
    if (!this.secureContext) {
      this.status = 'insecure';
      return;
    }
    if (!this.geolocation) {
      this.status = 'unsupported';
      return;
    }
    this.estimator.reset();
    this.status = 'waiting';
    this.watchId = this.geolocation.watchPosition(
      (position) => {
        this.estimator.update(toFix(position));
        this.status = 'active';
      },
      (error) => this.handleError(error),
      WATCH_OPTIONS,
    );
  }

  stop(): void {
    this.clearWatch();
    this.status = 'off';
  }

  speedKmh(nowMs: number): number {
    return this.estimator.speedKmh(nowMs);
  }

  snapshot(nowMs: number): GpsSnapshot {
    return {
      status: this.status,
      accuracyM: this.estimator.accuracyM,
      stale: this.estimator.isStale(nowMs),
      updateHz: this.estimator.updateHz,
      fixAgeMs: this.estimator.fixAgeMs(nowMs),
      source: this.estimator.source,
    };
  }

  private handleError(error: GeolocationPositionError): void {
    if (error.code === PERMISSION_DENIED) {
      this.clearWatch();
      this.status = 'denied';
      return;
    }
    // The watch keeps retrying after timeouts and transient failures, so only report them.
    this.status = error.code === POSITION_UNAVAILABLE ? 'unavailable' : 'timeout';
  }

  private clearWatch(): void {
    if (this.watchId === null) return;
    this.geolocation?.clearWatch(this.watchId);
    this.watchId = null;
  }
}

function toFix(position: GeolocationPosition): Fix {
  const { latitude, longitude, accuracy, speed } = position.coords;
  return {
    latitude,
    longitude,
    accuracyM: accuracy,
    speedMps: speed,
    timestampMs: position.timestamp,
  };
}
