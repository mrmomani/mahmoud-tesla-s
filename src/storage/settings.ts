export type SpeedUnit = 'kmh' | 'mph';

export interface Settings {
  readonly engineId: string;
  /** Volume in percent, 0..100. */
  readonly volume: number;
  readonly units: SpeedUnit;
  /** How eagerly acceleration turns into throttle, in percent; 50 is balanced. */
  readonly intensity: number;
  /** Pops and crackles when lifting off, in percent; 50 is each engine's own amount. */
  readonly crackle: number;
  /** Start the engine as soon as the page opens. */
  readonly autoStart: boolean;
  /** Register as media playback so the car can keep the engine going behind other screens. */
  readonly backgroundPlay: boolean;
}

// The speed mode is deliberately not stored: the app always opens following the car's GPS,
// so a demo or test drive left running while parked never carries over into the next drive.
export const SETTINGS_KEY = 'mahmoud-tesla-s:settings:v1';

export function defaultSettings(engineId: string): Settings {
  return {
    engineId,
    volume: 60,
    units: 'kmh',
    intensity: 50,
    crackle: 50,
    autoStart: false,
    backgroundPlay: false,
  };
}

/** Reads stored settings defensively; anything missing or invalid falls back to the defaults. */
export function parseSettings(
  raw: string | null,
  engineIds: readonly string[],
  defaults: Settings,
): Settings {
  if (!raw) return defaults;

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return defaults;
  }
  if (typeof data !== 'object' || data === null) return defaults;

  const { engineId, volume, units, intensity, crackle, autoStart, backgroundPlay } = data as Record<
    string,
    unknown
  >;
  return {
    engineId:
      typeof engineId === 'string' && engineIds.includes(engineId) ? engineId : defaults.engineId,
    volume: percent(volume, defaults.volume),
    units: units === 'kmh' || units === 'mph' ? units : defaults.units,
    intensity: percent(intensity, defaults.intensity),
    crackle: percent(crackle, defaults.crackle),
    autoStart: typeof autoStart === 'boolean' ? autoStart : defaults.autoStart,
    backgroundPlay: typeof backgroundPlay === 'boolean' ? backgroundPlay : defaults.backgroundPlay,
  };
}

function percent(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.round(Math.min(100, Math.max(0, value)))
    : fallback;
}

export function loadSettings(
  storage: Pick<Storage, 'getItem'> | null,
  engineIds: readonly string[],
  defaults: Settings,
): Settings {
  try {
    return parseSettings(storage?.getItem(SETTINGS_KEY) ?? null, engineIds, defaults);
  } catch {
    return defaults;
  }
}

export function saveSettings(storage: Pick<Storage, 'setItem'> | null, settings: Settings): void {
  try {
    storage?.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Storage can be full or blocked (private mode); settings just won't persist.
  }
}
