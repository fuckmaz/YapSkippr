import type { SegmentCandidate, TimedEvidence } from '../types';

export const HEURISTIC_DISPLAY_THRESHOLD = 0.4;
const PRESENCE_WINDOW_SECONDS = 20;
const FRAME_EVIDENCE_COALESCE_WINDOW_SECONDS = 6;
const MAX_SEGMENT_SECONDS = 240;
const DEFAULT_HIGH_CONFIDENCE_DURATION_SECONDS = 120;

export function buildSegmentCandidatePool(evidence: TimedEvidence[]): SegmentCandidate[] {
  const sorted = coalesceFrameEvidence([...evidence].sort((a, b) => a.startSeconds - b.startSeconds));
  const starts = sorted.filter((item) => item.kind === 'ad-read-start');
  const candidates =
    starts.length > 0
      ? starts.map((seed) => buildCandidateFromSeed(seed, sorted))
      : buildPresenceOnlyCandidates(sorted.filter((item) => item.kind === 'ad-read-presence'));

  return candidates.sort((a, b) => a.startSeconds - b.startSeconds);
}

export function buildSegmentCandidates(evidence: TimedEvidence[]): SegmentCandidate[] {
  return buildSegmentCandidatePool(evidence)
    .filter((candidate) => candidate.confidence >= HEURISTIC_DISPLAY_THRESHOLD);
}

function buildPresenceOnlyCandidates(presenceEvidence: TimedEvidence[]): SegmentCandidate[] {
  const groups: TimedEvidence[][] = [];

  for (const item of presenceEvidence) {
    const currentGroup = groups[groups.length - 1];
    const previous = currentGroup?.[currentGroup.length - 1];
    if (currentGroup && previous && item.startSeconds - previous.startSeconds <= PRESENCE_WINDOW_SECONDS) {
      currentGroup.push(item);
    } else {
      groups.push([item]);
    }
  }

  return groups.filter(isEligiblePresenceOnlyGroup).map((group) => {
    const sorted = group.sort((a, b) => a.startSeconds - b.startSeconds);
    return {
      startSeconds: sorted[0]?.startSeconds ?? 0,
      confidence: scoreEvidence(sorted),
      evidence: sorted
    };
  });
}

/**
 * Frame geometry is deliberately treated as corroborating evidence. A moving
 * playback control, audio meter, or generic QR URL must not create a skip on
 * its own. Sponsor-semantic QR payloads may surface directly; generic QR
 * payloads need persistence (three independently sampled observations) or a
 * different evidence source. Generic transcript calls to action also require
 * another evidence source; phrases such as "visit" and "check out" are too
 * common in ordinary content to form a segment by repetition alone.
 */
function isEligiblePresenceOnlyGroup(group: readonly TimedEvidence[]): boolean {
  const sources = new Set(group.map((item) => item.source));
  if (sources.size > 1) return true;

  const source = group[0]?.source;
  if (source === 'frame-visible-link') return true;
  if (source === 'frame-qr-code') {
    return group.some((item) => !isGenericQrEvidence(item)) || group.length >= 3;
  }
  return false;
}

function isGenericQrEvidence(evidence: TimedEvidence): boolean {
  if (evidence.source !== 'frame-qr-code') return false;
  if (!isRecord(evidence.raw)) return true;
  return readStringProperty(evidence.raw, 'signal') !== 'sponsor-cta';
}

function buildCandidateFromSeed(seed: TimedEvidence, allEvidence: TimedEvidence[]): SegmentCandidate {
  const related = new Set<TimedEvidence>([seed]);
  const end = allEvidence.find(
    (item) =>
      item.kind === 'ad-read-end' &&
      item.startSeconds > seed.startSeconds &&
      item.startSeconds <= seed.startSeconds + MAX_SEGMENT_SECONDS
  );

  for (const item of allEvidence) {
    if (item.kind !== 'ad-read-presence') continue;
    if (Math.abs(item.startSeconds - seed.startSeconds) <= PRESENCE_WINDOW_SECONDS) {
      related.add(item);
    }
  }

  if (end) related.add(end);

  const evidence = [...related].sort((a, b) => a.startSeconds - b.startSeconds);
  const confidence = scoreEvidence(evidence);
  const endSeconds = end?.startSeconds ?? (confidence >= 0.8 && seed.kind === 'ad-read-start' ? seed.startSeconds + DEFAULT_HIGH_CONFIDENCE_DURATION_SECONDS : undefined);

  return {
    startSeconds: seed.startSeconds,
    endSeconds,
    confidence,
    evidence
  };
}

function scoreEvidence(evidence: TimedEvidence[]): number {
  const score = evidence.reduce((total, item) => total + item.confidence * weightForEvidence(item), 0);
  return Math.min(0.98, Number(score.toFixed(3)));
}

function coalesceFrameEvidence(evidence: TimedEvidence[]): TimedEvidence[] {
  const coalesced: TimedEvidence[] = [];

  for (const item of evidence) {
    if (!isFrameEvidence(item)) {
      coalesced.push(item);
      continue;
    }

    const fingerprint = frameEvidenceFingerprint(item);
    const existingIndex = coalesced.findIndex((candidate) => {
      if (!isFrameEvidence(candidate)) return false;
      if (candidate.kind !== item.kind || candidate.source !== item.source) return false;
      if (Math.abs(item.startSeconds - candidate.startSeconds) > FRAME_EVIDENCE_COALESCE_WINDOW_SECONDS) return false;
      return frameEvidenceFingerprint(candidate) === fingerprint;
    });

    if (existingIndex === -1) {
      coalesced.push(item);
      continue;
    }

    const existing = coalesced[existingIndex];
    if (!existing || item.confidence <= existing.confidence) continue;

    coalesced[existingIndex] = {
      ...item,
      startSeconds: Math.min(existing.startSeconds, item.startSeconds)
    };
  }

  return coalesced.sort((a, b) => a.startSeconds - b.startSeconds);
}

function weightForEvidence(evidence: TimedEvidence): number {
  if (evidence.source === 'frame-progress-bar') return 0.5;
  if (evidence.source === 'frame-qr-code') return 0.5;
  if (evidence.source === 'frame-visible-link') return 0.65;
  if (evidence.kind === 'ad-read-start') return 0.75;
  if (evidence.kind === 'ad-read-end') return 0.2;
  return 0.45;
}

function isFrameEvidence(evidence: TimedEvidence): boolean {
  return evidence.source === 'frame-progress-bar' || evidence.source === 'frame-qr-code' || evidence.source === 'frame-visible-link';
}

function frameEvidenceFingerprint(evidence: TimedEvidence): string {
  if (evidence.source === 'frame-qr-code') return qrEvidenceFingerprint(evidence.raw);
  if (evidence.source === 'frame-progress-bar') return progressEvidenceFingerprint(evidence.raw);
  if (evidence.source === 'frame-visible-link') return visibleLinkEvidenceFingerprint(evidence.raw);
  return evidence.source;
}

function qrEvidenceFingerprint(raw: unknown): string {
  const value = readStringProperty(raw, 'value');
  return `qr:${value ?? 'detected'}`;
}

function progressEvidenceFingerprint(raw: unknown): string {
  if (!isRecord(raw)) return 'progress';
  return [
    'progress',
    readRoundedNumberProperty(raw, 'frameWidth', 1),
    readRoundedNumberProperty(raw, 'frameHeight', 1),
    readRoundedNumberProperty(raw, 'trackStartX', 4),
    readRoundedNumberProperty(raw, 'trackEndX', 4),
    readRoundedNumberProperty(raw, 'y', 4),
    readRoundedNumberProperty(raw, 'rows', 1),
    readRoundedNumberProperty(raw, 'fillRatio', 0.05)
  ].join(':');
}

function visibleLinkEvidenceFingerprint(raw: unknown): string {
  const text = readStringProperty(raw, 'text') ?? readStringProperty(raw, 'href') ?? readStringProperty(raw, 'url');
  return `link:${text ?? 'visible'}`;
}

function readStringProperty(value: unknown, key: string): string | null {
  if (!isRecord(value)) return null;
  const property = value[key];
  return typeof property === 'string' && property.trim() ? property.trim().toLowerCase() : null;
}

function readRoundedNumberProperty(value: Record<string, unknown>, key: string, precision: number): string {
  const property = value[key];
  if (typeof property !== 'number' || !Number.isFinite(property)) return '-';
  if (precision <= 1) return String(Math.round(property));
  return String(Math.round(property / precision) * precision);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
