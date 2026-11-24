import { easeInOut, lerp } from '../util/math';

interface Segment {
  readonly durationS: number;
  readonly toKmh: number;
}

/** A looping test drive that starts and ends at a standstill. */
const SEGMENTS: readonly Segment[] = [
  { durationS: 4, toKmh: 0 },
  { durationS: 14, toKmh: 110 },
  { durationS: 8, toKmh: 110 },
  { durationS: 9, toKmh: 45 },
  { durationS: 7, toKmh: 85 },
  { durationS: 12, toKmh: 0 },
];

export const DEMO_LOOP_S = SEGMENTS.reduce((total, segment) => total + segment.durationS, 0);

export function demoSpeedKmh(elapsedS: number): number {
  let t = ((elapsedS % DEMO_LOOP_S) + DEMO_LOOP_S) % DEMO_LOOP_S;
  let fromKmh = 0;
  for (const segment of SEGMENTS) {
    if (t < segment.durationS) {
      return lerp(fromKmh, segment.toKmh, easeInOut(t / segment.durationS));
    }
    t -= segment.durationS;
    fromKmh = segment.toKmh;
  }
  return fromKmh;
}
