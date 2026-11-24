import { describe, expect, it } from 'vitest';
import { loadSettings, parseSettings, SETTINGS_KEY, type Settings, saveSettings } from './settings';

const ENGINES = ['v8-muscle', 'v12-gt'];
const DEFAULTS: Settings = {
  engineId: 'v8-muscle',
  volume: 60,
  units: 'kmh',
  intensity: 50,
  crackle: 50,
  autoStart: false,
  backgroundPlay: false,
};

describe('settings', () => {
  it('falls back to defaults when nothing valid is stored', () => {
    expect(parseSettings(null, ENGINES, DEFAULTS)).toEqual(DEFAULTS);
    expect(parseSettings('not json', ENGINES, DEFAULTS)).toEqual(DEFAULTS);
    expect(parseSettings('42', ENGINES, DEFAULTS)).toEqual(DEFAULTS);
  });

  it('keeps valid values and repairs invalid ones individually', () => {
    const raw = JSON.stringify({
      engineId: 'v12-gt',
      volume: 140.4,
      units: 'furlongs',
      intensity: 80,
      crackle: -5,
      autoStart: 'yes',
    });
    expect(parseSettings(raw, ENGINES, DEFAULTS)).toEqual({
      ...DEFAULTS,
      engineId: 'v12-gt',
      volume: 100,
      intensity: 80,
      crackle: 0,
    });
  });

  it('falls back to the default engine when the stored one no longer exists', () => {
    const raw = JSON.stringify({ engineId: 'steam-engine', volume: 35, units: 'mph' });
    expect(parseSettings(raw, ENGINES, DEFAULTS)).toEqual({
      ...DEFAULTS,
      volume: 35,
      units: 'mph',
    });
  });

  it('round-trips through storage', () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
    };
    const saved: Settings = {
      engineId: 'v12-gt',
      volume: 25,
      units: 'mph',
      intensity: 70,
      crackle: 0,
      autoStart: true,
      backgroundPlay: true,
    };
    saveSettings(storage, saved);
    expect(store.has(SETTINGS_KEY)).toBe(true);
    expect(loadSettings(storage, ENGINES, DEFAULTS)).toEqual(saved);
  });

  it('keeps working when storage is blocked', () => {
    const blocked = {
      getItem: (): string | null => {
        throw new Error('blocked');
      },
      setItem: (): void => {
        throw new Error('full');
      },
    };
    expect(() => saveSettings(blocked, DEFAULTS)).not.toThrow();
    expect(loadSettings(blocked, ENGINES, DEFAULTS)).toEqual(DEFAULTS);
  });
});
