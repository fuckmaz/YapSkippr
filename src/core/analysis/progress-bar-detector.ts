import type { TimedEvidence } from '../types';

export interface ProgressBarDetectionOptions {
  ignoreBottomRatio: number;
  minWidthRatio: number;
  minContrast: number;
  minRows: number;
  maxHeightRatio: number;
  minTrackExtensionRatio: number;
}

export interface ProgressBarTracker {
  observe(evidence: readonly TimedEvidence[]): TimedEvidence[];
  reset(): void;
}

interface HorizontalRun {
  y: number;
  startX: number;
  endX: number;
  length: number;
}

interface ProgressGeometry {
  y: number;
  rows: number;
  frameWidth: number;
  frameHeight: number;
  trackStartX: number;
  trackEndX: number;
  fillStartX: number;
  fillEndX: number;
  fillRatio: number;
}

interface TrackedProgressGeometry extends ProgressGeometry {
  baselineFillRatio: number;
  firstSeenSeconds: number;
  lastSeenSeconds: number;
  observations: number;
  confirmed: boolean;
}

const DEFAULT_OPTIONS: ProgressBarDetectionOptions = {
  ignoreBottomRatio: 0.18,
  minWidthRatio: 0.35,
  minContrast: 80,
  minRows: 2,
  maxHeightRatio: 0.06,
  minTrackExtensionRatio: 0.08
};

const TRACK_MAX_GAP_SECONDS = 20;
const TRACK_MIN_FILL_DELTA = 0.025;
const TRACK_MAX_FILL_DELTA = 0.5;
const TRACK_POSITION_TOLERANCE_RATIO = 0.035;
const GEOMETRY_FILL_RATIO_TOLERANCE = 1e-6;

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

  const groupedRuns = groupAdjacentRuns(runs)
    .filter((group) => group.length >= resolved.minRows)
    .filter((group) => group.length <= Math.max(resolved.minRows, Math.ceil(height * resolved.maxHeightRatio)))
    .map((group) => ({ group, geometry: findProgressGeometry(group, imageData, resolved.minTrackExtensionRatio) }))
    .filter((candidate): candidate is { group: HorizontalRun[]; geometry: ProgressGeometry } => candidate.geometry !== null);
  if (groupedRuns.length === 0) return [];

  const bestCandidate = groupedRuns.sort((a, b) => scoreRunGroup(b.group, width) - scoreRunGroup(a.group, width))[0];
  if (!bestCandidate) return [];

  const { group: bestGroup, geometry } = bestCandidate;
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
        rows: bestGroup.length,
        frameWidth: width,
        frameHeight: height,
        trackStartX: geometry.trackStartX,
        trackEndX: geometry.trackEndX,
        fillRatio: geometry.fillRatio
      }
    }
  ];
}

export function createProgressBarTracker(): ProgressBarTracker {
  let tracked: TrackedProgressGeometry | null = null;

  return {
    observe(evidence): TimedEvidence[] {
      const currentEvidence = evidence.find((item) => item.source === 'frame-progress-bar');
      const geometry = currentEvidence ? readProgressGeometry(currentEvidence) : null;
      if (!currentEvidence || !geometry || !Number.isFinite(currentEvidence.startSeconds)) {
        tracked = null;
        return [];
      }

      const elapsedSeconds = tracked
        ? currentEvidence.startSeconds - tracked.lastSeenSeconds
        : null;
      if (
        !tracked ||
        !isSameTrack(tracked, geometry) ||
        elapsedSeconds === null ||
        elapsedSeconds <= 0 ||
        elapsedSeconds > TRACK_MAX_GAP_SECONDS
      ) {
        tracked = beginTracking(geometry, currentEvidence.startSeconds);
        return [];
      }

      const fillDelta = geometry.fillRatio - tracked.baselineFillRatio;
      if (Math.abs(fillDelta) > TRACK_MAX_FILL_DELTA) {
        tracked = beginTracking(geometry, currentEvidence.startSeconds);
        return [];
      }

      const previous = tracked;
      tracked = {
        ...geometry,
        baselineFillRatio: previous.baselineFillRatio,
        firstSeenSeconds: previous.firstSeenSeconds,
        lastSeenSeconds: currentEvidence.startSeconds,
        observations: previous.observations + 1,
        confirmed: previous.confirmed
      };

      if (
        previous.confirmed ||
        Math.abs(fillDelta) < TRACK_MIN_FILL_DELTA
      ) {
        return [];
      }

      tracked.confirmed = true;
      return [{
        ...currentEvidence,
        startSeconds: previous.firstSeenSeconds,
        confidence: Math.max(0.78, currentEvidence.confidence),
        reason: 'Confirmed a changing horizontal progress bar across consecutive video frames.',
        raw: {
          ...(isRecord(currentEvidence.raw) ? currentEvidence.raw : {}),
          confirmedAtSeconds: currentEvidence.startSeconds,
          temporalObservations: tracked.observations,
          fillDelta: Number(fillDelta.toFixed(4))
        }
      }];
    },
    reset(): void {
      tracked = null;
    }
  };
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

function findProgressGeometry(
  group: HorizontalRun[],
  imageData: ImageData,
  minTrackExtensionRatio: number
): ProgressGeometry | null {
  const minTrackLength = Math.ceil(imageData.width * minTrackExtensionRatio);
  const minMatchingRows = Math.ceil(group.length * 0.6);
  const matchingRows = group.flatMap((run) => {
    const rightTrack = countTrackPixels(imageData, run.y, run.endX + 1, 1);
    const leftTrack = countTrackPixels(imageData, run.y, run.startX - 1, -1);
    if (Math.max(rightTrack, leftTrack) < minTrackLength) return [];
    return [{ run, rightTrack, leftTrack }];
  });

  if (matchingRows.length < minMatchingRows) return null;
  const representative = matchingRows.reduce((best, row) => row.run.length > best.run.length ? row : best);
  const trackStartX = representative.run.startX - representative.leftTrack;
  const trackEndX = representative.run.endX + representative.rightTrack;
  const trackLength = trackEndX - trackStartX + 1;
  if (trackLength <= 0) return null;

  return {
    y: representative.run.y,
    rows: group.length,
    frameWidth: imageData.width,
    frameHeight: imageData.height,
    trackStartX,
    trackEndX,
    fillStartX: representative.run.startX,
    fillEndX: representative.run.endX,
    fillRatio: representative.run.length / trackLength
  };
}

function countTrackPixels(imageData: ImageData, y: number, startX: number, direction: -1 | 1): number {
  let count = 0;
  for (let x = startX; x >= 0 && x < imageData.width; x += direction) {
    if (!isDimTrackPixel(imageData, x, y)) break;
    count += 1;
  }
  return count;
}

function isDimTrackPixel(imageData: ImageData, x: number, y: number): boolean {
  const brightness = pixelBrightness(imageData, x, y);
  return brightness >= 50 && brightness <= 155;
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

function readProgressGeometry(evidence: TimedEvidence): ProgressGeometry | null {
  if (!isRecord(evidence.raw)) return null;
  const raw = evidence.raw;
  const values = {
    y: finiteNumber(raw.y),
    rows: finiteNumber(raw.rows),
    frameWidth: finiteNumber(raw.frameWidth),
    frameHeight: finiteNumber(raw.frameHeight),
    trackStartX: finiteNumber(raw.trackStartX),
    trackEndX: finiteNumber(raw.trackEndX),
    fillStartX: finiteNumber(raw.startX),
    fillEndX: finiteNumber(raw.endX),
    fillRatio: finiteNumber(raw.fillRatio)
  };
  if (Object.values(values).some((value) => value === null)) return null;
  const geometry = values as ProgressGeometry;
  return isValidProgressGeometry(geometry) ? geometry : null;
}

function isSameTrack(previous: ProgressGeometry, current: ProgressGeometry): boolean {
  return (
    normalizedDifference(previous.y, previous.frameHeight, current.y, current.frameHeight) <= TRACK_POSITION_TOLERANCE_RATIO &&
    normalizedDifference(previous.trackStartX, previous.frameWidth, current.trackStartX, current.frameWidth) <= TRACK_POSITION_TOLERANCE_RATIO &&
    normalizedDifference(previous.trackEndX, previous.frameWidth, current.trackEndX, current.frameWidth) <= TRACK_POSITION_TOLERANCE_RATIO
  );
}

function beginTracking(geometry: ProgressGeometry, startSeconds: number): TrackedProgressGeometry {
  return {
    ...geometry,
    baselineFillRatio: geometry.fillRatio,
    firstSeenSeconds: startSeconds,
    lastSeenSeconds: startSeconds,
    observations: 1,
    confirmed: false
  };
}

function isValidProgressGeometry(geometry: ProgressGeometry): boolean {
  const integerValues = [
    geometry.y,
    geometry.rows,
    geometry.frameWidth,
    geometry.frameHeight,
    geometry.trackStartX,
    geometry.trackEndX,
    geometry.fillStartX,
    geometry.fillEndX
  ];
  const trackLength = geometry.trackEndX - geometry.trackStartX + 1;
  const derivedFillRatio = trackLength > 0
    ? (geometry.fillEndX - geometry.fillStartX + 1) / trackLength
    : Number.NaN;
  return (
    integerValues.every(Number.isInteger) &&
    geometry.frameWidth > 0 &&
    geometry.frameHeight > 0 &&
    geometry.rows > 0 &&
    geometry.rows <= geometry.frameHeight &&
    geometry.y >= 0 &&
    geometry.y < geometry.frameHeight &&
    geometry.trackStartX >= 0 &&
    geometry.trackStartX <= geometry.trackEndX &&
    geometry.trackEndX < geometry.frameWidth &&
    geometry.fillStartX >= geometry.trackStartX &&
    geometry.fillStartX <= geometry.fillEndX &&
    geometry.fillEndX <= geometry.trackEndX &&
    geometry.fillRatio >= 0 &&
    geometry.fillRatio <= 1 &&
    Math.abs(geometry.fillRatio - derivedFillRatio) <= GEOMETRY_FILL_RATIO_TOLERANCE
  );
}

function normalizedDifference(
  previousPosition: number,
  previousDimension: number,
  currentPosition: number,
  currentDimension: number
): number {
  return Math.abs(previousPosition / previousDimension - currentPosition / currentDimension);
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
