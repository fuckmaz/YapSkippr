import type { EvidenceSource, SegmentCandidate } from '../core/types';

const SOURCE_LABELS: Record<EvidenceSource, string> = {
  transcript: 'transcript',
  'frame-qr-code': 'QR',
  'frame-progress-bar': 'progress bar'
};

const SOURCE_ORDER: EvidenceSource[] = ['transcript', 'frame-qr-code', 'frame-progress-bar'];

export function formatCandidateSummary(candidate: SegmentCandidate): string {
  const start = formatTimestamp(candidate.startSeconds);
  const end = candidate.endSeconds === undefined ? '?' : formatTimestamp(candidate.endSeconds);
  const confidence = `${Math.round(candidate.confidence * 100)}%`;
  const sources = formatSources(candidate);

  return `${start}-${end} · ${confidence} · ${sources}`;
}

function formatSources(candidate: SegmentCandidate): string {
  const sources = new Set(candidate.evidence.map((item) => item.source));
  return SOURCE_ORDER.filter((source) => sources.has(source))
    .map((source) => SOURCE_LABELS[source])
    .join(' + ');
}

function formatTimestamp(seconds: number): string {
  const rounded = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(rounded / 60);
  const remainingSeconds = rounded % 60;
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}
