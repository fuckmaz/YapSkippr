import type { ScanStatusPhase, ScanStatusSnapshot } from '../core/scan-status';

export interface PopupScanStatusView {
  title: string;
  phaseLabel: string;
  message: string;
  progressPercent: number;
  progressText: string;
  sampleCountText: string;
  candidateCountText: string;
  candidateSummaries: string[];
  updatedText: string;
  isRunning: boolean;
}

const phaseLabels: Record<ScanStatusPhase, string> = {
  idle: 'Idle',
  starting: 'Starting',
  transcript: 'Transcript',
  frames: 'Frames',
  fusion: 'Fusion',
  permission: 'Permission',
  stopped: 'Stopped',
  error: 'Error'
};

const runningPhases = new Set<ScanStatusPhase>(['starting', 'transcript', 'frames', 'fusion']);

export function createPopupScanStatusView(
  status: ScanStatusSnapshot,
  now = Date.now()
): PopupScanStatusView {
  const progressPercent = Math.round(clamp(status.progress, 0, 1) * 100);

  return {
    title: status.phase === 'idle' ? 'No active scan' : `${formatPlatform(status.platformId)} scan`,
    phaseLabel: phaseLabels[status.phase],
    message: status.message,
    progressPercent,
    progressText: `${progressPercent}%`,
    sampleCountText: formatCount(status.sampleCount, 'frame'),
    candidateCountText: formatCount(status.candidateCount, 'candidate'),
    candidateSummaries: status.candidates,
    updatedText: formatUpdatedAt(status.updatedAt, now),
    isRunning: runningPhases.has(status.phase)
  };
}

function formatPlatform(platformId: string | null): string {
  if (platformId === 'youtube') return 'YouTube';
  return 'Current';
}

function formatCount(count: number, singular: string): string {
  return `${count} ${count === 1 ? singular : `${singular}s`}`;
}

function formatUpdatedAt(updatedAt: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - updatedAt) / 1000));
  if (seconds < 60) return `Updated ${seconds}s ago`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `Updated ${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  return `Updated ${hours}h ago`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
