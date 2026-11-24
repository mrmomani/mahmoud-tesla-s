import { describe, expect, it } from 'vitest';
import { DEMO_LOOP_S, demoSpeedKmh } from './demo';

function sampleLoop(stepS: number): number[] {
  return Array.from({ length: Math.floor(DEMO_LOOP_S / stepS) + 1 }, (_, index) =>
    demoSpeedKmh(index * stepS),
  );
}

describe('demo drive', () => {
  it('starts and ends each loop at a standstill', () => {
    expect(demoSpeedKmh(0)).toBe(0);
    expect(demoSpeedKmh(DEMO_LOOP_S)).toBe(0);
    expect(demoSpeedKmh(DEMO_LOOP_S + 1)).toBe(demoSpeedKmh(1));
  });

  it('reaches highway speed', () => {
    expect(Math.max(...sampleLoop(0.5))).toBeCloseTo(110);
  });

  it('changes speed at a rate a real car could manage', () => {
    const stepS = 0.1;
    const speeds = sampleLoop(stepS);
    const rates = speeds
      .slice(1)
      .map((speed, index) => Math.abs(speed - (speeds[index] ?? speed)) / stepS);
    // 15 km/h per second is about 4.2 m/s², brisk but plausible.
    expect(Math.max(...rates)).toBeLessThan(15);
  });
});
