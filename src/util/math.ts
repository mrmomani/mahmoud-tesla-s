export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

/** First-order (exponential) smoothing toward `target`, independent of the frame rate. */
export function smoothToward(
  current: number,
  target: number,
  dtS: number,
  timeConstantS: number,
): number {
  if (timeConstantS <= 0) return target;
  return current + (target - current) * (1 - Math.exp(-dtS / timeConstantS));
}

/** Moves `current` toward `target` at a limited rate, in units per second. */
export function approach(
  current: number,
  target: number,
  dtS: number,
  risePerS: number,
  fallPerS: number,
): number {
  if (target > current) return Math.min(target, current + risePerS * dtS);
  return Math.max(target, current - fallPerS * dtS);
}

export function easeInOut(t: number): number {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}
