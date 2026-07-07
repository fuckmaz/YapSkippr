export interface FrameScanProgressInput {
  currentTimeSeconds: number | null;
  durationSeconds: number | null;
  sampleCount: number;
}

const BASE_FRAME_PROGRESS = 0.35;
const SAMPLE_PROGRESS_DIVISOR = 40;
const COMPLETION_EPSILON_SECONDS = 0.75;

export function calculateFrameScanProgress(input: FrameScanProgressInput): number {
  const sampleProgress = Math.min(0.95, BASE_FRAME_PROGRESS + Math.max(0, input.sampleCount) / SAMPLE_PROGRESS_DIVISOR);
  const playbackProgress = calculatePlaybackProgress(input.currentTimeSeconds, input.durationSeconds);

  return clamp(Math.max(sampleProgress, playbackProgress), 0, 1);
}

export function isVideoPlaybackComplete(currentTimeSeconds: number | null, durationSeconds: number | null): boolean {
  return (
    currentTimeSeconds !== null &&
    durationSeconds !== null &&
    durationSeconds > 0 &&
    currentTimeSeconds >= durationSeconds - COMPLETION_EPSILON_SECONDS
  );
}

function calculatePlaybackProgress(currentTimeSeconds: number | null, durationSeconds: number | null): number {
  if (currentTimeSeconds === null || durationSeconds === null || durationSeconds <= 0) return 0;
  if (isVideoPlaybackComplete(currentTimeSeconds, durationSeconds)) return 1;
  return currentTimeSeconds / durationSeconds;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
