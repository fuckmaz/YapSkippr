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
  modelText: string;
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
  feedbackSummary: string;
  feedbackReason: string;
  seekSeconds: number;
  endSeconds?: number;
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
  transcript: 'Captions',
  frames: 'Visual checks',
  fusion: 'Reviewing',
  done: 'Done',
  permission: 'Access',
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
    title: status.phase === 'idle' ? 'No active video' : `${formatPlatform(status.platformId)} video`,
    phaseLabel: stale ? 'Stale' : phaseLabels[status.phase],
    message: formatStatusMessage(status),
    progressPercent,
    progressText: `${progressPercent}%`,
    sampleCountText: formatCount(status.sampleCount, 'visual check'),
    candidateCountText: formatCount(status.candidateCount, 'possible ad read'),
    videoTimeText: formatVideoTime(status.videoCurrentTimeSeconds, status.videoDurationSeconds),
    modelText: formatModelText(status),
    fastScanText: status.fastScanEnabled
      ? `Visual checks · every ${status.fastScanIntervalSeconds}s`
      : 'Standard visual checks · every 5s',
    evidenceItems: [
      { label: 'Transcript', value: String(status.evidenceCounts.transcript) },
      { label: 'Progress', value: String(status.evidenceCounts.progressBar) },
      { label: 'QR', value: String(status.evidenceCounts.qrCode) },
      { label: 'Links', value: String(status.evidenceCounts.visibleLink) }
    ],
    candidates: status.candidates.map((candidate) => ({
      id: candidate.id,
      summary: formatCandidateSummary(candidate),
      detail: formatCandidateDetail(candidate),
      feedbackSummary: candidate.summary,
      feedbackReason: formatCandidateFeedbackReason(candidate),
      seekSeconds: candidate.startSeconds,
      ...(candidate.endSeconds === undefined ? {} : { endSeconds: candidate.endSeconds }),
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
      confidenceText: `Detector score: ${Math.round(evidence.confidence * 100)}%`,
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

function formatModelText(status: ScanStatusSnapshot): string {
  if (status.model.status === 'loaded' && status.model.modelId && status.model.modelVersion) {
    return `${status.model.modelId} · ${status.model.modelVersion} · ${status.model.modelSource}`;
  }

  const suffix = formatModelMessageSuffix(status.model.message);
  if (status.model.status === 'error') return `Model error${suffix}`;
  return `Heuristic fallback${suffix}`;
}

function formatModelMessageSuffix(message: string): string {
  const trimmed = message.trim();
  if (!trimmed || trimmed === 'Heuristic confidence only.') return '';
  return ` · ${trimmed}`;
}

function formatCandidateDetail(candidate: ScanStatusSnapshot['candidates'][number]): string {
  const sourceText = candidate.sources.join(' + ') || 'unknown source';
  if (candidate.modelConfidence !== undefined && candidate.heuristicConfidence !== undefined) {
    return `Detector score: ${Math.round(candidate.modelConfidence * 100)}% model · ${Math.round(candidate.heuristicConfidence * 100)}% heuristic`;
  }
  return `Detector score: ${Math.round(candidate.confidence * 100)}% heuristic · ${sourceText}`;
}

function formatCandidateFeedbackReason(candidate: ScanStatusSnapshot['candidates'][number]): string {
  const sourceText = candidate.sources.join(' + ') || 'unknown source';
  if (candidate.modelConfidence !== undefined && candidate.heuristicConfidence !== undefined) {
    return `${Math.round(candidate.modelConfidence * 100)}% model · ${Math.round(candidate.heuristicConfidence * 100)}% heuristic · ${sourceText}`;
  }
  return `${Math.round(candidate.confidence * 100)}% confidence · ${sourceText}`;
}

function formatCandidateSummary(candidate: ScanStatusSnapshot['candidates'][number]): string {
  const start = formatTimestamp(candidate.startSeconds);
  const sourceText = candidate.sources.join(' + ') || 'detected signals';
  if (candidate.endSeconds === undefined) return `From ${start} · ${sourceText}`;
  return `${start}–${formatTimestamp(candidate.endSeconds)} · ${sourceText}`;
}

function formatStatusMessage(status: ScanStatusSnapshot): string {
  if (status.phase === 'idle') return 'Open a YouTube video to start detecting ad reads.';
  if (status.phase === 'starting') return 'Getting detection ready...';
  if (status.phase === 'transcript') return 'Checking the video captions for ad reads...';
  if (status.phase === 'frames') {
    return status.sampleCount === 0
      ? 'Checking the video for visual ad-read signs...'
      : `Checking the video for visual ad-read signs · ${formatCount(status.sampleCount, 'check')} complete`;
  }
  if (status.phase === 'fusion') return 'Reviewing the strongest ad-read signs...';
  if (status.phase === 'done') {
    return status.candidateCount === 0
      ? 'Finished checking. No ad reads found.'
      : `Found ${formatCount(status.candidateCount, 'possible ad read')}.`;
  }
  if (status.phase === 'permission') return 'Visual checks need access. Use the access control above.';
  return replaceTechnicalTerms(status.message);
}

function replaceTechnicalTerms(message: string): string {
  return message
    .replace(/recognition model/gi, 'detector')
    .replace(/transcript cues?/gi, 'caption signals')
    .replace(/frame analysis/gi, 'visual checks')
    .replace(/frames? sampled/gi, 'visual checks completed')
    .replace(/analyzing frames/gi, 'checking the video');
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
