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
  /** Fixes from the live watch and from the once-a-second fallback request. */
  readonly fixes: { readonly live: number; readonly fallback: number };
  /** The speed the browser reported in the latest fix; null when it reported none. */
  readonly reportedKmh: number | null;
  /** Speed worked out from recent positions. */
  readonly derivedKmh: number | null;
  /** How far the browser's own fix timestamps are from this device's clock. */
  readonly clockOffsetMs: number | null;
  readonly lastError: string | null;
}

export interface GpsSource {
  start(): void;
  stop(): void;
  speedKmh(nowMs: number): number;
  snapshot(nowMs: number): GpsSnapshot;
}

type Scheduler = (tick: () => void, intervalMs: number) => () => void;

export interface GpsSpeedSourceOptions {
  readonly geolocation?: Geolocation | undefined;
  readonly secureContext?: boolean;
  /** Wall clock in epoch milliseconds; each fix is stamped with it when it arrives. */
  readonly now?: () => number;
  readonly schedule?: Scheduler;
}

const PERMISSION_DENIED = 1;
const POSITION_UNAVAILABLE = 2;
const ERROR_NAMES: Record<number, string> = {
  1: 'Permission denied',
  2: 'Position unavailable',
  3: 'Timed out',
};

const POSITION_OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  maximumAge: 0,
  timeout: 15_000,
};
/** How often to check whether the live watch has gone quiet. */
const POLL_CHECK_MS = 250;
/** Ask for a position directly once the live watch has been quiet this long. */
const POLL_WHEN_QUIET_MS = 1100;
/** A fallback request still unanswered after this long no longer holds up the next one. */
const POLL_GIVE_UP_MS = 5000;
/** Errors only change the status once fixes have stopped for this long. */
const ERROR_GRACE_MS = 4000;

const intervalScheduler: Scheduler = (tick, intervalMs) => {
  const id = setInterval(tick, intervalMs);
  return () => clearInterval(id);
};

/**
 * Watches the browser's position and exposes the resulting speed. Car browsers have shipped
 * position updates that stall or carry timestamps from another clock, so fixes are stamped on
 * arrival and a direct request fills in whenever the live watch goes quiet.
 */
export class GpsSpeedSource implements GpsSource {
  private readonly geolocation: Geolocation | undefined;
  private readonly secureContext: boolean;
  private readonly now: () => number;
  private readonly schedule: Scheduler;
  private readonly estimator = new SpeedEstimator();
  /** Changes on every start and stop, so late callbacks from an earlier run are ignored. */
  private session = 0;
  private started = false;
  private watchId: number | null = null;
  private cancelPoll: (() => void) | null = null;
  private pollSentMs: number | null = null;
  private lastFixMs: number | null = null;
  private status: GpsStatus = 'off';
  private liveFixes = 0;
  private fallbackFixes = 0;
  private clockOffsetMs: number | null = null;
  private lastError: string | null = null;

  constructor(options: GpsSpeedSourceOptions = {}) {
    this.geolocation =
      'geolocation' in options ? options.geolocation : globalThis.navigator?.geolocation;
    this.secureContext = options.secureContext ?? globalThis.isSecureContext ?? true;
    this.now = options.now ?? (() => Date.now());
    this.schedule = options.schedule ?? intervalScheduler;
  }

  start(): void {
    if (this.started) return;
    if (!this.secureContext) {
      this.status = 'insecure';
      return;
    }
    const geolocation = this.geolocation;
    if (!geolocation) {
      this.status = 'unsupported';
      return;
    }
    this.started = true;
    this.session += 1;
    const session = this.session;
    this.estimator.reset();
    this.lastFixMs = null;
    this.pollSentMs = null;
    this.liveFixes = 0;
    this.fallbackFixes = 0;
    this.clockOffsetMs = null;
    this.lastError = null;
    this.status = 'waiting';
    try {
      this.watchId = geolocation.watchPosition(
        (position) => this.receive(session, position, 'live'),
        (error) => this.fail(session, error),
        POSITION_OPTIONS,
      );
    } catch (error) {
      // The fallback request below may still work, so record the failure and carry on.
      this.lastError = describeError(error);
    }
    this.cancelPoll = this.schedule(() => this.poll(session), POLL_CHECK_MS);
  }

  stop(): void {
    this.halt();
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
      fixes: { live: this.liveFixes, fallback: this.fallbackFixes },
      reportedKmh: this.estimator.lastReportedKmh,
      derivedKmh: this.estimator.lastDerivedKmh,
      clockOffsetMs: this.clockOffsetMs,
      lastError: this.lastError,
    };
  }

  private poll(session: number): void {
    const geolocation = this.geolocation;
    if (!geolocation || session !== this.session) return;
    const nowMs = this.now();
    if (this.lastFixMs !== null && nowMs - this.lastFixMs < POLL_WHEN_QUIET_MS) return;
    if (this.pollSentMs !== null && nowMs - this.pollSentMs < POLL_GIVE_UP_MS) return;
    this.pollSentMs = nowMs;
    try {
      geolocation.getCurrentPosition(
        (position) => {
          if (session === this.session) this.pollSentMs = null;
          this.receive(session, position, 'fallback');
        },
        (error) => {
          if (session === this.session) this.pollSentMs = null;
          this.fail(session, error);
        },
        POSITION_OPTIONS,
      );
    } catch (error) {
      this.pollSentMs = null;
      this.lastError = describeError(error);
      if (this.status === 'waiting') this.status = 'unavailable';
    }
  }

  private receive(session: number, position: GeolocationPosition, via: 'live' | 'fallback'): void {
    if (session !== this.session) return;
    const receivedMs = this.now();
    if (via === 'live') this.liveFixes += 1;
    else this.fallbackFixes += 1;
    this.lastFixMs = receivedMs;
    this.clockOffsetMs = Number.isFinite(position.timestamp)
      ? position.timestamp - receivedMs
      : null;
    this.estimator.update(toFix(position, receivedMs));
    this.status = 'active';
  }

  private fail(session: number, error: GeolocationPositionError): void {
    if (session !== this.session) return;
    this.lastError = describeError(error);
    if (error.code === PERMISSION_DENIED) {
      this.halt();
      this.status = 'denied';
      return;
    }
    // Requests keep going after timeouts and brief outages, so only report those once fixes stop.
    const quiet = this.lastFixMs === null || this.now() - this.lastFixMs > ERROR_GRACE_MS;
    if (quiet) this.status = error.code === POSITION_UNAVAILABLE ? 'unavailable' : 'timeout';
  }

  private halt(): void {
    this.session += 1;
    this.started = false;
    this.cancelPoll?.();
    this.cancelPoll = null;
    this.pollSentMs = null;
    if (this.watchId !== null) {
      try {
        this.geolocation?.clearWatch(this.watchId);
      } catch {
        // Nothing more to stop.
      }
      this.watchId = null;
    }
  }
}

function toFix(position: GeolocationPosition, receivedMs: number): Fix {
  const { latitude, longitude, accuracy, speed } = position.coords;
  return {
    latitude,
    longitude,
    accuracyM: Number.isFinite(accuracy) && accuracy > 0 ? accuracy : null,
    speedMps: speed !== null && Number.isFinite(speed) && speed >= 0 ? speed : null,
    // Stamped on arrival: some browsers fill position.timestamp from a different clock.
    timestampMs: receivedMs,
  };
}

function describeError(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = Number(error.code);
    const name = ERROR_NAMES[code] ?? `Error ${code}`;
    const message = 'message' in error ? String(error.message) : '';
    return message ? `${name}: ${message}` : name;
  }
  return error instanceof Error ? error.message : String(error);
}
