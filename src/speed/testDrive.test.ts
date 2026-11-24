import { describe, expect, it } from 'vitest';
import { stepTestDrive, TEST_DRIVE_TOP_KMH } from './testDrive';

function drive(speedKmh: number, gas: number, brake: number, seconds: number): number {
  let speed = speedKmh;
  for (let step = 0; step < seconds * 25; step++) {
    speed = stepTestDrive(speed, { gas, brake }, 0.04);
  }
  return speed;
}

describe('stepTestDrive', () => {
  it('builds speed on the gas pedal without passing the top speed', () => {
    expect(drive(0, 1, 0, 5)).toBeGreaterThan(50);
    expect(drive(0, 1, 0, 120)).toBeLessThanOrEqual(TEST_DRIVE_TOP_KMH);
  });

  it('brakes to a standstill without rolling backwards', () => {
    expect(drive(100, 0, 1, 10)).toBe(0);
  });

  it('coasts down gently when neither pedal is pressed', () => {
    const speed = drive(100, 0, 0, 1);
    expect(speed).toBeGreaterThan(96);
    expect(speed).toBeLessThan(100);
  });
});
