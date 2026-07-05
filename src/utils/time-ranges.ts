export function clampSeconds(value: number, min = 0): number {
  return Number.isFinite(value) ? Math.max(min, value) : min;
}

export function rangesOverlap(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
  toleranceSeconds = 0
): boolean {
  return aStart <= bEnd + toleranceSeconds && bStart <= aEnd + toleranceSeconds;
}
