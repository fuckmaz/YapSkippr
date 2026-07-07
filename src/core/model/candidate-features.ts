import type { EvidenceSource, SegmentCandidate, TimedEvidence } from '../types';

export const FEATURE_SCHEMA_VERSION = 1;

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

function hasNearbyEndCue(candidate: SegmentCandidate): boolean {
  return candidate.evidence.some((item) => {
    if (item.kind !== 'ad-read-end') return false;
    if (candidate.endSeconds !== undefined) {
      return Math.abs(item.startSeconds - candidate.endSeconds) <= 10;
    }
    return item.startSeconds >= candidate.startSeconds && item.startSeconds <= candidate.startSeconds + 240;
  });
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
