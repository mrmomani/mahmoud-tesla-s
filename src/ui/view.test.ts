import { describe, expect, it } from 'vitest';
import type { Telemetry } from '../app/controller';
import type { GpsSnapshot } from '../speed/gpsSource';
import { describeDiagnostics, describeStatus, formatSpeed, pedalForKey } from './view';

function gps(overrides: Partial<GpsSnapshot> = {}): GpsSnapshot {
  return {
    status: 'active',
    accuracyM: 8,
    stale: false,
    updateHz: 1,
    fixAgeMs: 400,
    source: 'device',
    fixes: { live: 12, fallback: 3 },
    reportedKmh: 50,
    derivedKmh: 48,
    clockOffsetMs: 300,
    lastError: null,
    ...overrides,
  };
}

function telemetry(overrides: Partial<Telemetry> = {}): Telemetry {
  const speedKmh = overrides.speedKmh ?? 0;
  return {
    running: true,
    mode: 'gps',
    speedKmh,
    rpm: 800,
    gear: speedKmh > 2 ? '3' : 'N',
    load: 0.2,
    redlineRpm: 6500,
    canRev: speedKmh < 5,
    gps: gps(),
    audio: { state: 'running', latencyMs: 25, sampleRate: 48000, background: 'off' },
    ...overrides,
  };
}

describe('describeStatus', () => {
  it('calls a quiet GPS ready while parked instead of reporting a lost signal', () => {
    const message = describeStatus(telemetry({ gps: gps({ stale: true }) }));
    expect(message.tone).toBe('ok');
    expect(message.text).toMatch(/ready/i);
  });

  it('reports a lost signal while moving', () => {
    const message = describeStatus(telemetry({ speedKmh: 70, gps: gps({ stale: true }) }));
    expect(message.tone).toBe('warn');
    expect(message.text).toMatch(/lost/i);
  });

  it('warns when the fix is too imprecise to measure speed', () => {
    const message = describeStatus(telemetry({ gps: gps({ accuracyM: 10_000 }) }));
    expect(message.tone).toBe('warn');
    expect(message.text).toContain('10.0 km');
  });

  it('asks for a tap when the browser holds the sound back', () => {
    const message = describeStatus(
      telemetry({
        audio: { state: 'suspended', latencyMs: null, sampleRate: 48000, background: 'off' },
      }),
    );
    expect(message.tone).toBe('warn');
    expect(message.text).toMatch(/tap anywhere/i);
  });
});

describe('describeDiagnostics', () => {
  it('shows live GPS readings while driving on GPS', () => {
    const readings = describeDiagnostics(telemetry());
    expect(readings.rate).toBe('1.0 per second');
    expect(readings.age).toBe('0.4 s ago');
    expect(readings.accuracy).toBe('±8 m');
    expect(readings.fixes).toBe('15 (12 live, 3 fallback)');
    expect(readings.clock).toBe('In sync');
    expect(readings.error).toBe('None');
  });

  it('shows raw speeds in the chosen units and says when the browser reports none', () => {
    expect(describeDiagnostics(telemetry(), 'mph').reported).toBe('31 mph');
    expect(describeDiagnostics(telemetry(), 'mph').derived).toBe('30 mph');
    expect(describeDiagnostics(telemetry({ gps: gps({ reportedKmh: null }) })).reported).toBe(
      'Not provided',
    );
  });

  it('flags a browser clock that is far off', () => {
    const offByHours = gps({ clockOffsetMs: -3 * 3600 * 1000 });
    expect(describeDiagnostics(telemetry({ gps: offByHours })).clock).toBe(
      'Off by 3.0 h (not used)',
    );
  });

  it('hides old GPS readings in the other modes', () => {
    const readings = describeDiagnostics(telemetry({ mode: 'demo', gps: gps({ status: 'off' }) }));
    expect(readings.gps).toBe('Not used in Demo drive');
    expect(readings.rate).toBe('–');
    expect(readings.age).toBe('–');
    expect(readings.fixes).toBe('–');
    expect(readings.reported).toBe('–');
  });
});

describe('formatSpeed', () => {
  it('converts the speed for drivers who use miles per hour', () => {
    expect(formatSpeed(100, 'kmh')).toBe('100');
    expect(formatSpeed(100, 'mph')).toBe('62');
  });
});

describe('pedalForKey', () => {
  it('leaves arrow keys to focused sliders and radio buttons', () => {
    expect(pedalForKey('ArrowUp', false)).toBe('gas');
    expect(pedalForKey('ArrowDown', false)).toBe('brake');
    expect(pedalForKey('ArrowUp', true)).toBeNull();
    expect(pedalForKey('W', true)).toBe('gas');
    expect(pedalForKey('s', true)).toBe('brake');
  });
});
