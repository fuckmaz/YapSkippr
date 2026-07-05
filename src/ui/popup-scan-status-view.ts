import type { ScanStatusPhase, ScanStatusSnapshot } from '../core/scan-status';

export interface PopupScanStatusView {
  title: string;
  phaseLabel: string;
  message: string;
  progressPercent: number;
  progressText: string;
  sampleCountText: string;
  candidateCountText: string;
  videoTimeText: string;
  evidenceItems: PopupEvidenceItem[];
  candidates: PopupCandidateView[];
  events: PopupEventView[];
  updatedText: string;
  isRunning: boolean;
}

export interface PopupEvidenceItem {
  label: string;
  value: string;
}

export interface PopupCandidateView {
  id: string;
  summary: string;
  detail: string;
  seekSeconds: number;
  actionLabel: string;
}

export interface PopupEventView {
  id: string;
  level: 'info' | 'warn' | 'error';
  message: string;
  ageText: string;
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
    videoTimeText: formatVideoTime(status.videoCurrentTimeSeconds, status.videoDurationSeconds),
    evidenceItems: [
      { label: 'Transcript', value: String(status.evidenceCounts.transcript) },
      { label: 'Progress', value: String(status.evidenceCounts.progressBar) },
      { label: 'QR', value: String(status.evidenceCounts.qrCode) }
    ],
    candidates: status.candidates.map((candidate) => ({
      id: candidate.id,
      summary: candidate.summary,
      detail: `${Math.round(candidate.confidence * 100)}% confidence · ${candidate.sources.join(' + ') || 'unknown source'}`,
      seekSeconds: candidate.startSeconds,
      actionLabel: `Jump to ${formatTimestamp(candidate.startSeconds)}`
    })),
    events: status.recentEvents.map((event) => ({
      id: event.id,
      level: event.level,
      message: event.message,
      ageText: formatAge(event.timestamp, now)
    })),
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
  return `Updated ${formatAge(updatedAt, now)}`;
}

function formatAge(timestamp: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s ago`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

function formatVideoTime(current: number | null, duration: number | null): string {
  if (current === null || duration === null) return 'No video timing';
  return `${formatTimestamp(current)} / ${formatTimestamp(duration)}`;
}

function formatTimestamp(seconds: number): string {
  const rounded = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(rounded / 60);
  const remainingSeconds = rounded % 60;
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
