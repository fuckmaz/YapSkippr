import type { EvidenceSource, SegmentCandidate, TimedEvidence } from '../types';

export const FEATURE_SCHEMA_VERSION = 2;

export interface ExtractCandidateFeatureOptions {
  videoDurationSeconds?: number | null;
  transcriptContext?: string;
}

export interface ExtractedCandidateFeatures {
  schemaVersion: typeof FEATURE_SCHEMA_VERSION;
  features: CandidateFeatureVector;
  phraseGroupIds: string[];
}

export interface CandidateFeatureVector extends Record<string, number> {
  heuristicConfidence: number;
  evidenceTotal: number;
  transcriptStartCount: number;
  transcriptPresenceCount: number;
  transcriptEndCount: number;
  qrCount: number;
  progressBarCount: number;
  visibleLinkCount: number;
  qrLocationCount: number;
  avgQrBoxAreaPixels: number;
  avgQrBoxCenterX: number;
  avgQrBoxCenterY: number;
  avgProgressBarWidthPixels: number;
  avgProgressBarY: number;
  avgProgressBarRows: number;
  maxTranscriptConfidence: number;
  avgTranscriptConfidence: number;
  maxQrConfidence: number;
  avgQrConfidence: number;
  maxProgressBarConfidence: number;
  avgProgressBarConfidence: number;
  maxVisibleLinkConfidence: number;
  avgVisibleLinkConfidence: number;
  startSeconds: number;
  durationSeconds: number;
  isOpenEnded: number;
  normalizedVideoPosition: number;
  evidenceTimeSpanSeconds: number;
  hasTranscriptAndQr: number;
  hasTranscriptAndVisibleLink: number;
  hasTranscriptAndProgressBar: number;
  hasQrAndVisibleLink: number;
  isFrameOnly: number;
  isTranscriptOnly: number;
  matchedPhraseGroupCount: number;
  sponsorPhraseHitCount: number;
  callToActionPhraseHitCount: number;
  nearbyEndCue: number;
}

const sponsorPhrases = [
  'sponsored by',
  'made possible by',
  'brought to you by',
  'presented by',
  'thanks to our sponsor',
  'support for this channel',
  'partnered with',
  'in partnership with'
];

const callToActionPhrases = [
  'use code',
  'promo code',
  'discount code',
  'coupon code',
  'offer code',
  'link in the description',
  'click the link',
  'check out',
  'free trial',
  'sign up',
  'head to',
  'go to',
  'visit'
];

export function extractCandidateFeatures(
  candidate: SegmentCandidate,
  options: ExtractCandidateFeatureOptions = {}
): ExtractedCandidateFeatures {
  const transcriptEvidence = filterEvidence(candidate.evidence, 'transcript');
  const qrEvidence = filterEvidence(candidate.evidence, 'frame-qr-code');
  const progressBarEvidence = filterEvidence(candidate.evidence, 'frame-progress-bar');
  const visibleLinkEvidence = filterEvidence(candidate.evidence, 'frame-visible-link');
  const phraseGroupIds = extractPhraseGroupIds(candidate.evidence);
  const durationSeconds = candidate.endSeconds === undefined
    ? 0
    : round(Math.max(0, candidate.endSeconds - candidate.startSeconds));
  const videoDurationSeconds = options.videoDurationSeconds ?? null;
  const textCorpus = buildTextCorpus(candidate.evidence, options.transcriptContext);
  const qrGeometry = summarizeQrGeometry(qrEvidence);
  const progressBarGeometry = summarizeProgressBarGeometry(progressBarEvidence);

  return {
    schemaVersion: FEATURE_SCHEMA_VERSION,
    features: {
      heuristicConfidence: round(candidate.heuristicConfidence ?? candidate.confidence),
      evidenceTotal: candidate.evidence.length,
      transcriptStartCount: countEvidence(transcriptEvidence, 'ad-read-start'),
      transcriptPresenceCount: countEvidence(transcriptEvidence, 'ad-read-presence'),
      transcriptEndCount: countEvidence(transcriptEvidence, 'ad-read-end'),
      qrCount: qrEvidence.length,
      progressBarCount: progressBarEvidence.length,
      visibleLinkCount: visibleLinkEvidence.length,
      qrLocationCount: qrGeometry.count,
      avgQrBoxAreaPixels: qrGeometry.avgAreaPixels,
      avgQrBoxCenterX: qrGeometry.avgCenterX,
      avgQrBoxCenterY: qrGeometry.avgCenterY,
      avgProgressBarWidthPixels: progressBarGeometry.avgWidthPixels,
      avgProgressBarY: progressBarGeometry.avgY,
      avgProgressBarRows: progressBarGeometry.avgRows,
      maxTranscriptConfidence: maxConfidence(transcriptEvidence),
      avgTranscriptConfidence: avgConfidence(transcriptEvidence),
      maxQrConfidence: maxConfidence(qrEvidence),
      avgQrConfidence: avgConfidence(qrEvidence),
      maxProgressBarConfidence: maxConfidence(progressBarEvidence),
      avgProgressBarConfidence: avgConfidence(progressBarEvidence),
      maxVisibleLinkConfidence: maxConfidence(visibleLinkEvidence),
      avgVisibleLinkConfidence: avgConfidence(visibleLinkEvidence),
      startSeconds: round(candidate.startSeconds),
      durationSeconds,
      isOpenEnded: candidate.endSeconds === undefined ? 1 : 0,
      normalizedVideoPosition: videoDurationSeconds && videoDurationSeconds > 0
        ? round(candidate.startSeconds / videoDurationSeconds)
        : 0,
      evidenceTimeSpanSeconds: evidenceTimeSpanSeconds(candidate.evidence),
      hasTranscriptAndQr: bool(transcriptEvidence.length > 0 && qrEvidence.length > 0),
      hasTranscriptAndVisibleLink: bool(transcriptEvidence.length > 0 && visibleLinkEvidence.length > 0),
      hasTranscriptAndProgressBar: bool(transcriptEvidence.length > 0 && progressBarEvidence.length > 0),
      hasQrAndVisibleLink: bool(qrEvidence.length > 0 && visibleLinkEvidence.length > 0),
      isFrameOnly: bool(transcriptEvidence.length === 0 && candidate.evidence.length > 0),
      isTranscriptOnly: bool(transcriptEvidence.length > 0 && candidate.evidence.length === transcriptEvidence.length),
      matchedPhraseGroupCount: phraseGroupIds.length,
      sponsorPhraseHitCount: countUniquePhraseHits(textCorpus, sponsorPhrases),
      callToActionPhraseHitCount: countUniquePhraseHits(textCorpus, callToActionPhrases),
      nearbyEndCue: bool(hasNearbyEndCue(candidate))
    },
    phraseGroupIds
  };
}

function filterEvidence(evidence: readonly TimedEvidence[], source: EvidenceSource): TimedEvidence[] {
  return evidence.filter((item) => item.source === source);
}

function countEvidence(evidence: readonly TimedEvidence[], kind: TimedEvidence['kind']): number {
  return evidence.filter((item) => item.kind === kind).length;
}

function maxConfidence(evidence: readonly TimedEvidence[]): number {
  if (evidence.length === 0) return 0;
  return round(Math.max(...evidence.map((item) => item.confidence)));
}

function avgConfidence(evidence: readonly TimedEvidence[]): number {
  if (evidence.length === 0) return 0;
  return round(evidence.reduce((total, item) => total + item.confidence, 0) / evidence.length);
}

function evidenceTimeSpanSeconds(evidence: readonly TimedEvidence[]): number {
  if (evidence.length === 0) return 0;
  const starts = evidence.map((item) => item.startSeconds);
  return round(Math.max(...starts) - Math.min(...starts));
}

function summarizeQrGeometry(evidence: readonly TimedEvidence[]): {
  count: number;
  avgAreaPixels: number;
  avgCenterX: number;
  avgCenterY: number;
} {
  const boxes = evidence.flatMap((item) => {
    if (!isRecord(item.raw) || !isRecord(item.raw.location)) return [];
    const topLeft = getPoint(item.raw.location.topLeftCorner);
    const bottomRight = getPoint(item.raw.location.bottomRightCorner);
    if (!topLeft || !bottomRight) return [];

    const width = Math.max(0, bottomRight.x - topLeft.x);
    const height = Math.max(0, bottomRight.y - topLeft.y);
    if (width <= 0 || height <= 0) return [];

    return [{
      areaPixels: width * height,
      centerX: topLeft.x + width / 2,
      centerY: topLeft.y + height / 2
    }];
  });

  return {
    count: boxes.length,
    avgAreaPixels: avgValues(boxes.map((box) => box.areaPixels)),
    avgCenterX: avgValues(boxes.map((box) => box.centerX)),
    avgCenterY: avgValues(boxes.map((box) => box.centerY))
  };
}

function summarizeProgressBarGeometry(evidence: readonly TimedEvidence[]): {
  avgWidthPixels: number;
  avgY: number;
  avgRows: number;
} {
  const bars = evidence.flatMap((item) => {
    if (!isRecord(item.raw)) return [];
    const startX = finiteNumber(item.raw.startX);
    const endX = finiteNumber(item.raw.endX);
    const y = finiteNumber(item.raw.y);
    const rows = finiteNumber(item.raw.rows);
    if (startX === null || endX === null || y === null || rows === null) return [];

    const width = Math.max(0, endX - startX + 1);
    if (width <= 0 || rows <= 0) return [];
    return [{ width, y, rows }];
  });

  return {
    avgWidthPixels: avgValues(bars.map((bar) => bar.width)),
    avgY: avgValues(bars.map((bar) => bar.y)),
    avgRows: avgValues(bars.map((bar) => bar.rows))
  };
}

function hasNearbyEndCue(candidate: SegmentCandidate): boolean {
  return candidate.evidence.some((item) => {
    if (item.kind !== 'ad-read-end') return false;
    if (candidate.endSeconds !== undefined) {
      return Math.abs(item.startSeconds - candidate.endSeconds) <= 10;
    }
    return item.startSeconds >= candidate.startSeconds && item.startSeconds <= candidate.startSeconds + 240;
  });
}

function getPoint(value: unknown): { x: number; y: number } | null {
  if (!isRecord(value)) return null;
  const x = finiteNumber(value.x);
  const y = finiteNumber(value.y);
  if (x === null || y === null) return null;
  return { x, y };
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function avgValues(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return round(values.reduce((total, value) => total + value, 0) / values.length);
}

function extractPhraseGroupIds(evidence: readonly TimedEvidence[]): string[] {
  const ids = new Set<string>();

  for (const item of evidence) {
    if (!isRecord(item.raw)) continue;
    const phraseGroupId = item.raw.phraseGroupId;
    if (typeof phraseGroupId === 'string' && phraseGroupId.trim()) ids.add(phraseGroupId);
    const phraseGroupIds = item.raw.phraseGroupIds;
    if (Array.isArray(phraseGroupIds)) {
      for (const id of phraseGroupIds) {
        if (typeof id === 'string' && id.trim()) ids.add(id);
      }
    }
  }

  return [...ids].sort();
}

function buildTextCorpus(evidence: readonly TimedEvidence[], transcriptContext = ''): string {
  const parts = [transcriptContext];
  for (const item of evidence) {
    parts.push(item.reason);
    if (!isRecord(item.raw)) continue;
    if (typeof item.raw.text === 'string') parts.push(item.raw.text);
    if (typeof item.raw.phrase === 'string') parts.push(item.raw.phrase);
    if (typeof item.raw.value === 'string') parts.push(item.raw.value);
    if (Array.isArray(item.raw.links)) parts.push(...item.raw.links.filter((link): link is string => typeof link === 'string'));
  }
  return normalizeText(parts.join(' '));
}

function countUniquePhraseHits(text: string, phrases: readonly string[]): number {
  return phrases.reduce((count, phrase) => count + (matchesPhrase(text, phrase) ? 1 : 0), 0);
}

function matchesPhrase(normalizedText: string, phrase: string): boolean {
  const normalizedPhrase = normalizeText(phrase);
  if (!normalizedPhrase) return false;
  if (normalizedPhrase.includes(' ')) return normalizedText.includes(normalizedPhrase);
  return new RegExp(`\\b${escapeRegExp(normalizedPhrase)}\\b`).test(normalizedText);
}

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[’']/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function bool(value: boolean): number {
  return value ? 1 : 0;
}

function round(value: number): number {
  return Number(value.toFixed(6));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
