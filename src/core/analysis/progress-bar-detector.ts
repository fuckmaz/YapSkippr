import type { TimedEvidence } from '../types';

export interface ProgressBarDetectionOptions {
  ignoreBottomRatio: number;
  minWidthRatio: number;
  minContrast: number;
  minRows: number;
}

interface HorizontalRun {
  y: number;
  startX: number;
  endX: number;
  length: number;
}

const DEFAULT_OPTIONS: ProgressBarDetectionOptions = {
  ignoreBottomRatio: 0.18,
  minWidthRatio: 0.35,
  minContrast: 80,
  minRows: 2
};

export function detectProgressBarCue(
  imageData: ImageData,
  currentTimeSeconds: number,
  options: Partial<ProgressBarDetectionOptions> = {}
): TimedEvidence[] {
  const resolved = { ...DEFAULT_OPTIONS, ...options };
  const { width, height } = imageData;
  if (width <= 0 || height <= 0) return [];

  const maxY = Math.max(0, Math.floor(height * (1 - resolved.ignoreBottomRatio)));
  const minRunLength = Math.ceil(width * resolved.minWidthRatio);
  const runs: HorizontalRun[] = [];

  for (let y = 0; y < maxY; y += 1) {
    let startX: number | null = null;

    for (let x = 0; x < width; x += 1) {
      const isCandidatePixel = isBrightContrastingPixel(imageData, x, y, resolved.minContrast);
      if (isCandidatePixel && startX === null) {
        startX = x;
      }
      if ((!isCandidatePixel || x === width - 1) && startX !== null) {
        const endX = isCandidatePixel && x === width - 1 ? x : x - 1;
        const length = endX - startX + 1;
        if (length >= minRunLength) {
          runs.push({ y, startX, endX, length });
        }
        startX = null;
      }
    }
  }

  if (runs.length === 0) return [];

  const groupedRuns = groupAdjacentRuns(runs).filter((group) => group.length >= resolved.minRows);
  if (groupedRuns.length === 0) return [];

  const bestGroup = groupedRuns.sort((a, b) => scoreRunGroup(b, width) - scoreRunGroup(a, width))[0];
  if (!bestGroup) return [];

  const widestRun = bestGroup.reduce((best, run) => (run.length > best.length ? run : best), bestGroup[0]!);
  const widthRatio = widestRun.length / width;
  const rowBonus = Math.min(0.2, Math.max(0, bestGroup.length - 1) * 0.08);
  const confidence = clamp(0.2 + widthRatio * 0.45 + rowBonus, 0.2, 0.75);

  return [
    {
      source: 'frame-progress-bar',
      kind: 'ad-read-presence',
      startSeconds: currentTimeSeconds,
      confidence,
      reason: `Detected horizontal progress-bar-like line across ${Math.round(widthRatio * 100)}% of frame width.`,
      raw: {
        y: widestRun.y,
        startX: widestRun.startX,
        endX: widestRun.endX,
        rows: bestGroup.length
      }
    }
  ];
}

function isBrightContrastingPixel(imageData: ImageData, x: number, y: number, minContrast: number): boolean {
  const brightness = pixelBrightness(imageData, x, y);
  const localBackground = Math.min(
    pixelBrightness(imageData, Math.max(0, x - 2), y),
    pixelBrightness(imageData, Math.min(imageData.width - 1, x + 2), y),
    pixelBrightness(imageData, x, Math.max(0, y - 2)),
    pixelBrightness(imageData, x, Math.min(imageData.height - 1, y + 2))
  );

  return brightness >= 160 && brightness - localBackground >= minContrast;
}

function pixelBrightness(imageData: ImageData, x: number, y: number): number {
  const offset = (y * imageData.width + x) * 4;
  return ((imageData.data[offset] ?? 0) + (imageData.data[offset + 1] ?? 0) + (imageData.data[offset + 2] ?? 0)) / 3;
}

function groupAdjacentRuns(runs: HorizontalRun[]): HorizontalRun[][] {
  const groups: HorizontalRun[][] = [];
  for (const run of runs) {
    const previous = groups[groups.length - 1];
    const lastRun = previous?.[previous.length - 1];
    if (previous && lastRun && run.y === lastRun.y + 1 && Math.abs(run.startX - lastRun.startX) <= 3 && Math.abs(run.endX - lastRun.endX) <= 3) {
      previous.push(run);
    } else {
      groups.push([run]);
    }
  }
  return groups;
}

function scoreRunGroup(group: HorizontalRun[], width: number): number {
  const widest = Math.max(...group.map((run) => run.length));
  return widest / width + group.length * 0.1;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
