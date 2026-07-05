export const SCAN_STATUS_STORAGE_KEY = 'yapskippr.scanStatus';

export type ScanStatusPhase =
  | 'idle'
  | 'starting'
  | 'transcript'
  | 'frames'
  | 'fusion'
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
  candidateCount: number;
  candidates: string[];
  updatedAt: number;
}

export type ScanStatusPatch = Partial<Omit<ScanStatusSnapshot, 'updatedAt'>>;

const phases = new Set<ScanStatusPhase>([
  'idle',
  'starting',
  'transcript',
  'frames',
  'fusion',
  'permission',
  'stopped',
  'error'
]);

export function createIdleScanStatus(now = Date.now()): ScanStatusSnapshot {
  return {
    platformId: null,
    videoId: null,
    pageUrl: null,
    phase: 'idle',
    message: 'No active scan.',
    progress: 0,
    sampleCount: 0,
    candidateCount: 0,
    candidates: [],
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
    candidateCount: nonNegativeInteger(value.candidateCount),
    candidates: Array.isArray(value.candidates)
      ? value.candidates.filter((candidate): candidate is string => typeof candidate === 'string').slice(0, 5)
      : [],
    updatedAt: nonNegativeInteger(value.updatedAt, now)
  };
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

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function nonNegativeInteger(value: unknown, fallback = 0): number {
  return Math.max(0, Math.floor(numberOr(value, fallback)));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
