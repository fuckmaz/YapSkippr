import type { EvidenceKind, EvidenceSource, TimedEvidence } from './types';

export const SCAN_STATUS_STORAGE_KEY = 'yapskippr.scanStatus';

export type ScanStatusPhase =
  | 'idle'
  | 'starting'
  | 'transcript'
  | 'frames'
  | 'fusion'
  | 'done'
  | 'permission'
  | 'stopped'
  | 'error';

export interface ScanStatusSnapshot {
  platformId: string | null;
  videoId: string | null;
  pageUrl: string | null;
  phase: ScanStatusPhase;
  message: string;
  progress: number;
  sampleCount: number;
  videoCurrentTimeSeconds: number | null;
  videoDurationSeconds: number | null;
  fastScanEnabled: boolean;
  fastScanIntervalSeconds: number;
  candidateCount: number;
  evidenceCounts: ScanEvidenceCounts;
  candidates: ScanStatusCandidate[];
  recentEvidence: ScanStatusEvidence[];
  recentEvents: ScanStatusEvent[];
  updatedAt: number;
}

export interface ScanEvidenceCounts {
  transcript: number;
  progressBar: number;
  qrCode: number;
  visibleLink: number;
  total: number;
}

export interface ScanStatusCandidate {
  id: string;
  startSeconds: number;
  endSeconds?: number;
  confidence: number;
  summary: string;
  sources: string[];
}

export interface ScanStatusEvidence {
  id: string;
  source: EvidenceSource;
  kind: EvidenceKind;
  startSeconds: number;
  endSeconds?: number;
  confidence: number;
  reason: string;
  detail?: string;
}

export type ScanStatusEventLevel = 'info' | 'warn' | 'error';

export interface ScanStatusEvent {
  id: string;
  level: ScanStatusEventLevel;
  message: string;
  timestamp: number;
  detail?: string;
}

export type ScanStatusPatch = Partial<Omit<ScanStatusSnapshot, 'updatedAt'>>;

const phases = new Set<ScanStatusPhase>([
  'idle',
  'starting',
  'transcript',
  'frames',
  'fusion',
  'done',
  'permission',
  'stopped',
  'error'
]);

const runningPhases = new Set<ScanStatusPhase>(['starting', 'transcript', 'frames', 'fusion']);

export function createIdleScanStatus(now = Date.now()): ScanStatusSnapshot {
  return {
    platformId: null,
    videoId: null,
    pageUrl: null,
    phase: 'idle',
    message: 'No active scan.',
    progress: 0,
    sampleCount: 0,
    videoCurrentTimeSeconds: null,
    videoDurationSeconds: null,
    fastScanEnabled: false,
    fastScanIntervalSeconds: 2,
    candidateCount: 0,
    evidenceCounts: createEmptyEvidenceCounts(),
    candidates: [],
    recentEvidence: [],
    recentEvents: [],
    updatedAt: now
  };
}

export function mergeScanStatus(
  previous: ScanStatusSnapshot,
  patch: ScanStatusPatch,
  now = Date.now()
): ScanStatusSnapshot {
  return normalizeScanStatus(
    {
      ...previous,
      ...patch,
      updatedAt: now
    },
    now
  );
}

export function normalizeScanStatus(value: unknown, now = Date.now()): ScanStatusSnapshot {
  if (!isRecord(value) || !isScanStatusPhase(value.phase)) {
    return createIdleScanStatus(now);
  }

  return {
    platformId: nullableString(value.platformId),
    videoId: nullableString(value.videoId),
    pageUrl: nullableString(value.pageUrl),
    phase: value.phase,
    message: typeof value.message === 'string' && value.message.trim() ? value.message : 'No active scan.',
    progress: clamp(numberOr(value.progress, 0), 0, 1),
    sampleCount: nonNegativeInteger(value.sampleCount),
    videoCurrentTimeSeconds: nullableNonNegativeNumber(value.videoCurrentTimeSeconds),
    videoDurationSeconds: nullableNonNegativeNumber(value.videoDurationSeconds),
    fastScanEnabled: value.fastScanEnabled === true,
    fastScanIntervalSeconds: clamp(nonNegativeInteger(value.fastScanIntervalSeconds, 2), 1, 5),
    candidateCount: nonNegativeInteger(value.candidateCount),
    evidenceCounts: normalizeEvidenceCounts(value.evidenceCounts),
    candidates: normalizeCandidates(value.candidates),
    recentEvidence: normalizeRecentEvidence(value.recentEvidence),
    recentEvents: normalizeEvents(value.recentEvents),
    updatedAt: nonNegativeInteger(value.updatedAt, now)
  };
}

export function appendScanStatusEvent(
  status: ScanStatusSnapshot,
  event: Omit<ScanStatusEvent, 'id'> & { id?: string }
): ScanStatusSnapshot {
  const timestamp = nonNegativeInteger(event.timestamp, Date.now());
  return {
    ...status,
    updatedAt: timestamp,
    recentEvents: [
      {
        id: event.id ?? `${timestamp}-${event.message}`,
        level: event.level,
        message: event.message,
        timestamp,
        ...(event.detail ? { detail: event.detail } : {})
      },
      ...status.recentEvents
    ].slice(0, 16)
  };
}

export function appendScanStatusEvidence(
  status: ScanStatusSnapshot,
  evidence: readonly TimedEvidence[],
  timestamp = Date.now()
): ScanStatusSnapshot {
  if (evidence.length === 0) return status;

  const recentEvidence = evidence.map((item, index) => toScanStatusEvidence(item, timestamp, index));
  const recentEvents = recentEvidence.map((item) => ({
    id: `${item.id}-event`,
    level: 'info' as const,
    message: `${formatEvidenceSource(item.source)} evidence at ${formatTimestamp(item.startSeconds)}`,
    timestamp,
    detail: item.reason
  }));

  return {
    ...status,
    recentEvidence: [...recentEvidence, ...status.recentEvidence].slice(0, 16),
    recentEvents: [...recentEvents, ...status.recentEvents].slice(0, 16),
    updatedAt: timestamp
  };
}

export function createEmptyEvidenceCounts(): ScanEvidenceCounts {
  return {
    transcript: 0,
    progressBar: 0,
    qrCode: 0,
    visibleLink: 0,
    total: 0
  };
}

export function isScanStatusStale(status: ScanStatusSnapshot, now = Date.now(), thresholdMs = 15_000): boolean {
  return runningPhases.has(status.phase) && now - status.updatedAt > thresholdMs;
}

function isScanStatusPhase(value: unknown): value is ScanStatusPhase {
  return typeof value === 'string' && phases.has(value as ScanStatusPhase);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

function nullableNonNegativeNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function nonNegativeInteger(value: unknown, fallback = 0): number {
  return Math.max(0, Math.floor(numberOr(value, fallback)));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeEvidenceCounts(value: unknown): ScanEvidenceCounts {
  if (!isRecord(value)) return createEmptyEvidenceCounts();

  const transcript = nonNegativeInteger(value.transcript);
  const progressBar = nonNegativeInteger(value.progressBar);
  const qrCode = nonNegativeInteger(value.qrCode);
  const visibleLink = nonNegativeInteger(value.visibleLink);
  const total = nonNegativeInteger(value.total, transcript + progressBar + qrCode + visibleLink);

  return {
    transcript,
    progressBar,
    qrCode,
    visibleLink,
    total
  };
}

function normalizeCandidates(value: unknown): ScanStatusCandidate[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((candidate): ScanStatusCandidate[] => {
    if (!isRecord(candidate)) return [];
    const id = nullableString(candidate.id);
    const summary = nullableString(candidate.summary);
    const startSeconds = nullableNonNegativeNumber(candidate.startSeconds);
    const confidence = typeof candidate.confidence === 'number' && Number.isFinite(candidate.confidence)
      ? clamp(candidate.confidence, 0, 1)
      : null;

    if (!id || !summary || startSeconds === null || confidence === null) return [];

    return [
      {
        id,
        startSeconds,
        ...(nullableNonNegativeNumber(candidate.endSeconds) !== null
          ? { endSeconds: nullableNonNegativeNumber(candidate.endSeconds) as number }
          : {}),
        confidence,
        summary,
        sources: Array.isArray(candidate.sources)
          ? candidate.sources.filter((source): source is string => typeof source === 'string' && source.length > 0)
          : []
      }
    ];
  }).slice(0, 5);
}

function normalizeRecentEvidence(value: unknown): ScanStatusEvidence[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((evidence): ScanStatusEvidence[] => {
    if (!isRecord(evidence)) return [];
    const id = nullableString(evidence.id);
    const source = evidence.source;
    const kind = evidence.kind;
    const startSeconds = nullableNonNegativeNumber(evidence.startSeconds);
    const confidence = typeof evidence.confidence === 'number' && Number.isFinite(evidence.confidence)
      ? clamp(evidence.confidence, 0, 1)
      : null;
    const reason = nullableString(evidence.reason);

    if (!id || !isEvidenceSource(source) || !isEvidenceKind(kind) || startSeconds === null || confidence === null || !reason) {
      return [];
    }

    return [
      {
        id,
        source,
        kind,
        startSeconds,
        ...(nullableNonNegativeNumber(evidence.endSeconds) !== null
          ? { endSeconds: nullableNonNegativeNumber(evidence.endSeconds) as number }
          : {}),
        confidence,
        reason,
        ...(nullableString(evidence.detail) ? { detail: nullableString(evidence.detail) as string } : {})
      }
    ];
  }).slice(0, 16);
}

function normalizeEvents(value: unknown): ScanStatusEvent[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((event): ScanStatusEvent[] => {
    if (!isRecord(event)) return [];
    const id = nullableString(event.id);
    const level = event.level;
    const message = nullableString(event.message);
    const timestamp = nullableNonNegativeNumber(event.timestamp);

    if (!id || !isEventLevel(level) || !message || timestamp === null) return [];

    return [
      {
        id,
        level,
        message,
        timestamp,
        ...(nullableString(event.detail) ? { detail: nullableString(event.detail) as string } : {})
      }
    ];
  }).slice(0, 16);
}

function isEventLevel(value: unknown): value is ScanStatusEventLevel {
  return value === 'info' || value === 'warn' || value === 'error';
}

function toScanStatusEvidence(evidence: TimedEvidence, timestamp: number, index: number): ScanStatusEvidence {
  return {
    id: `${timestamp}-${index}-${evidence.source}-${Math.round(evidence.startSeconds)}`,
    source: evidence.source,
    kind: evidence.kind,
    startSeconds: evidence.startSeconds,
    ...(evidence.endSeconds === undefined ? {} : { endSeconds: evidence.endSeconds }),
    confidence: clamp(evidence.confidence, 0, 1),
    reason: evidence.reason,
    ...(summarizeRawEvidence(evidence.raw) ? { detail: summarizeRawEvidence(evidence.raw) as string } : {})
  };
}

function summarizeRawEvidence(raw: unknown): string | null {
  if (!isRecord(raw)) return null;

  if (Array.isArray(raw.links)) {
    const links = raw.links.filter((link): link is string => typeof link === 'string' && link.length > 0);
    if (links.length > 0) return links.join(', ');
  }

  if (typeof raw.value === 'string' && raw.value.trim()) return raw.value.trim();
  if (typeof raw.text === 'string' && raw.text.trim()) return raw.text.trim();
  return null;
}

function formatEvidenceSource(source: EvidenceSource): string {
  if (source === 'transcript') return 'Transcript';
  if (source === 'frame-progress-bar') return 'Progress bar';
  if (source === 'frame-qr-code') return 'QR';
  return 'Visible link';
}

function formatTimestamp(seconds: number): string {
  const rounded = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(rounded / 60);
  const remainingSeconds = rounded % 60;
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}

function isEvidenceSource(value: unknown): value is EvidenceSource {
  return value === 'transcript' || value === 'frame-progress-bar' || value === 'frame-qr-code' || value === 'frame-visible-link';
}

function isEvidenceKind(value: unknown): value is EvidenceKind {
  return value === 'ad-read-start' || value === 'ad-read-end' || value === 'ad-read-presence';
}
