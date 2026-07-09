import type { SegmentCandidate, TimedEvidence } from '../types';

const DISPLAY_THRESHOLD = 0.4;
const PRESENCE_WINDOW_SECONDS = 20;
const MAX_SEGMENT_SECONDS = 240;
const DEFAULT_HIGH_CONFIDENCE_DURATION_SECONDS = 120;

export function buildSegmentCandidates(evidence: TimedEvidence[]): SegmentCandidate[] {
  const sorted = [...evidence].sort((a, b) => a.startSeconds - b.startSeconds);
  const starts = sorted.filter((item) => item.kind === 'ad-read-start');
  const candidates =
    starts.length > 0
      ? starts.map((seed) => buildCandidateFromSeed(seed, sorted))
      : buildPresenceOnlyCandidates(sorted.filter((item) => item.kind === 'ad-read-presence'));

  return candidates
    .filter((candidate) => candidate.confidence >= DISPLAY_THRESHOLD)
    .sort((a, b) => a.startSeconds - b.startSeconds);
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

  return groups.map((group) => {
    const sorted = group.sort((a, b) => a.startSeconds - b.startSeconds);
    return {
      startSeconds: sorted[0]?.startSeconds ?? 0,
      confidence: scoreEvidence(sorted),
      evidence: sorted
    };
  });
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

function weightForEvidence(evidence: TimedEvidence): number {
  if (evidence.source === 'frame-progress-bar') return 0.52;
  if (evidence.source === 'frame-qr-code') return 0.45;
  if (evidence.source === 'frame-visible-link') return 0.65;
  if (evidence.kind === 'ad-read-start') return 0.75;
  if (evidence.kind === 'ad-read-end') return 0.2;
  return 0.45;
}
