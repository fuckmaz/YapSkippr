import { isScanStatusStale, type ScanStatusPhase, type ScanStatusSnapshot } from '../core/scan-status';
import type { EvidenceKind, EvidenceSource } from '../core/types';

export interface PopupScanStatusView {
  title: string;
  phaseLabel: string;
  message: string;
  progressPercent: number;
  progressText: string;
  sampleCountText: string;
  candidateCountText: string;
  videoTimeText: string;
  fastScanText: string;
  evidenceItems: PopupEvidenceItem[];
  candidates: PopupCandidateView[];
  events: PopupEventView[];
  evidenceEvents: PopupEvidenceEventView[];
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
  detail?: string;
  ageText: string;
}

export interface PopupEvidenceEventView {
  id: string;
  sourceLabel: string;
  kindLabel: string;
  timeLabel: string;
  startSeconds: number;
  confidenceText: string;
  reason: string;
  detail?: string;
}

const phaseLabels: Record<ScanStatusPhase, string> = {
  idle: 'Idle',
  starting: 'Starting',
  transcript: 'Transcript',
  frames: 'Frames',
  fusion: 'Fusion',
  done: 'Done',
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
  const stale = isScanStatusStale(status, now);

  return {
    title: status.phase === 'idle' ? 'No active scan' : `${formatPlatform(status.platformId)} scan`,
    phaseLabel: stale ? 'Stale' : phaseLabels[status.phase],
    message: status.message,
    progressPercent,
    progressText: `${progressPercent}%`,
    sampleCountText: formatCount(status.sampleCount, 'frame'),
    candidateCountText: formatCount(status.candidateCount, 'candidate'),
    videoTimeText: formatVideoTime(status.videoCurrentTimeSeconds, status.videoDurationSeconds),
    fastScanText: status.fastScanEnabled ? `Fast pre-scan on · ${status.fastScanIntervalSeconds}s interval` : 'Fast pre-scan off',
    evidenceItems: [
      { label: 'Transcript', value: String(status.evidenceCounts.transcript) },
      { label: 'Progress', value: String(status.evidenceCounts.progressBar) },
      { label: 'QR', value: String(status.evidenceCounts.qrCode) },
      { label: 'Links', value: String(status.evidenceCounts.visibleLink) }
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
      ...(event.detail ? { detail: event.detail } : {}),
      ageText: formatAge(event.timestamp, now)
    })),
    evidenceEvents: status.recentEvidence.map((evidence) => ({
      id: evidence.id,
      sourceLabel: formatEvidenceSource(evidence.source),
      kindLabel: formatEvidenceKind(evidence.kind),
      timeLabel: formatTimestamp(evidence.startSeconds),
      startSeconds: evidence.startSeconds,
      confidenceText: `${Math.round(evidence.confidence * 100)}%`,
      reason: evidence.reason,
      ...(evidence.detail ? { detail: evidence.detail } : {})
    })),
    updatedText: formatUpdatedAt(status.updatedAt, now),
    isRunning: !stale && runningPhases.has(status.phase)
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

function formatEvidenceSource(source: EvidenceSource): string {
  if (source === 'transcript') return 'Transcript';
  if (source === 'frame-progress-bar') return 'Progress bar';
  if (source === 'frame-qr-code') return 'QR';
  return 'Visible link';
}

function formatEvidenceKind(kind: EvidenceKind): string {
  if (kind === 'ad-read-start') return 'Start';
  if (kind === 'ad-read-end') return 'End';
  return 'Presence';
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
