import {
  FEATURE_SCHEMA_VERSION,
  extractCandidateFeatures,
  type CandidateFeatureVector,
  type ExtractCandidateFeatureOptions
} from './candidate-features';
import { HEURISTIC_DISPLAY_THRESHOLD } from '../analysis/evidence-fusion';
import type { SegmentCandidate } from '../types';

export type CandidateModelSource = 'bundled' | 'downloaded' | 'fallback';

export interface CandidateModelArtifact {
  modelId: string;
  modelVersion: string;
  featureSchemaVersion: number;
  createdAt: string;
  promotedAt?: string | null;
  intercept: number;
  weights: Record<string, number>;
  thresholds: Record<string, number>;
  metrics: Record<string, number>;
  trainingSetSummary: Record<string, number>;
  boundaryCalibration?: BoundaryCalibrationArtifact;
}

export interface BoundaryCalibrationProfile {
  startOffsetSeconds: number;
  endOffsetSeconds?: number;
  trainingExamples: number;
  validationExamples: number;
  videoGroups: number;
  baselineMaeSeconds: number;
  calibratedMaeSeconds: number;
}

export interface BoundaryCalibrationArtifact {
  version: 1;
  global?: BoundaryCalibrationProfile;
  bySource: Record<string, BoundaryCalibrationProfile>;
}

export interface ApplyCandidateModelOptions extends ExtractCandidateFeatureOptions {
  model: CandidateModelArtifact | null;
  modelSource: CandidateModelSource;
}

export interface CandidateModelThresholds {
  positive: number;
  review: number;
}

export interface CandidateSelectionResult {
  displayedCandidates: SegmentCandidate[];
  reviewCandidates: SegmentCandidate[];
  rejectedCandidates: SegmentCandidate[];
  thresholds: CandidateModelThresholds;
}

export function validateCandidateModel(value: unknown): CandidateModelArtifact | null {
  if (!isRecord(value)) return null;
  if (typeof value.modelId !== 'string' || !value.modelId.trim()) return null;
  if (typeof value.modelVersion !== 'string' || !value.modelVersion.trim()) return null;
  if (value.featureSchemaVersion !== FEATURE_SCHEMA_VERSION) return null;
  if (typeof value.createdAt !== 'string' || !value.createdAt.trim()) return null;
  if (!isFiniteNumber(value.intercept)) return null;
  if (!isFiniteNumberRecord(value.weights)) return null;
  if (!isFiniteNumberRecord(value.thresholds) || !parseCandidateModelThresholds(value.thresholds)) return null;
  if (!isFiniteNumberRecord(value.metrics)) return null;
  if (!isFiniteNumberRecord(value.trainingSetSummary)) return null;
  const boundaryCalibration = value.boundaryCalibration === undefined
    ? undefined
    : parseBoundaryCalibration(value.boundaryCalibration);
  if (value.boundaryCalibration !== undefined && !boundaryCalibration) return null;

  return {
    modelId: value.modelId,
    modelVersion: value.modelVersion,
    featureSchemaVersion: value.featureSchemaVersion,
    createdAt: value.createdAt,
    promotedAt: typeof value.promotedAt === 'string' ? value.promotedAt : null,
    intercept: value.intercept,
    weights: value.weights,
    thresholds: value.thresholds,
    metrics: value.metrics,
    trainingSetSummary: value.trainingSetSummary,
    ...(boundaryCalibration ? { boundaryCalibration } : {})
  };
}

export function scoreCandidateFeatures(
  model: CandidateModelArtifact,
  features: Record<string, number>
): number {
  const logit = Object.entries(model.weights).reduce(
    (total, [featureName, weight]) => total + (features[featureName] ?? 0) * weight,
    model.intercept
  );
  return round(sigmoid(logit));
}

export function applyModelToCandidate(
  candidate: SegmentCandidate,
  options: ApplyCandidateModelOptions
): SegmentCandidate {
  const extracted = extractCandidateFeatures(candidate, options);
  const modelConfidence = options.model ? scoreCandidateFeatures(options.model, extracted.features) : undefined;
  const heuristicConfidence = round(candidate.heuristicConfidence ?? candidate.confidence);

  const scoredCandidate: SegmentCandidate = {
    ...candidate,
    confidence: modelConfidence ?? heuristicConfidence,
    heuristicConfidence,
    modelConfidence,
    modelId: options.model?.modelId ?? null,
    modelVersion: options.model?.modelVersion ?? null,
    modelSource: options.model ? options.modelSource : 'fallback',
    featureSchemaVersion: extracted.schemaVersion,
    candidateFeatures: extracted.features,
    phraseGroupIds: extracted.phraseGroupIds,
    ...(options.transcriptContext ? { transcriptContext: options.transcriptContext } : {})
  };
  return options.model?.boundaryCalibration
    ? applyBoundaryCalibration(scoredCandidate, options.model.boundaryCalibration)
    : scoredCandidate;
}

export function applyBoundaryCalibration(
  candidate: SegmentCandidate,
  calibration: BoundaryCalibrationArtifact
): SegmentCandidate {
  const source = [...candidate.evidence]
    .sort((left, right) => {
      const leftStartRank = left.kind === 'ad-read-start' ? 0 : 1;
      const rightStartRank = right.kind === 'ad-read-start' ? 0 : 1;
      return leftStartRank - rightStartRank
        || Math.abs(left.startSeconds - candidate.startSeconds) - Math.abs(right.startSeconds - candidate.startSeconds);
    })[0]?.source;
  const profile = (source ? calibration.bySource[source] : undefined) ?? calibration.global;
  if (!profile) return candidate;

  const startSeconds = Math.max(0, round(candidate.startSeconds + profile.startOffsetSeconds));
  const endSeconds = candidate.endSeconds === undefined
    ? undefined
    : round(candidate.endSeconds + (profile.endOffsetSeconds ?? profile.startOffsetSeconds));
  if (endSeconds !== undefined && endSeconds <= startSeconds + 1) return candidate;
  return {
    ...candidate,
    startSeconds,
    ...(endSeconds === undefined ? {} : { endSeconds })
  };
}

export function applyModelToCandidates(
  candidates: readonly SegmentCandidate[],
  options: ApplyCandidateModelOptions & {
    getTranscriptContext?: (candidate: SegmentCandidate) => string;
  }
): SegmentCandidate[] {
  return candidates.map((candidate) => applyModelToCandidate(candidate, {
    ...options,
    transcriptContext: options.getTranscriptContext?.(candidate) ?? options.transcriptContext
  }));
}

export function selectCandidateSegments(
  candidates: readonly SegmentCandidate[],
  options: ApplyCandidateModelOptions & {
    getTranscriptContext?: (candidate: SegmentCandidate) => string;
  }
): CandidateSelectionResult {
  const scoredCandidates = applyModelToCandidates(candidates, options);
  const thresholds = options.model
    ? parseCandidateModelThresholds(options.model.thresholds) ?? fallbackCandidateModelThresholds()
    : fallbackCandidateModelThresholds();

  return {
    displayedCandidates: scoredCandidates.filter((candidate) => candidate.confidence >= thresholds.positive),
    reviewCandidates: scoredCandidates.filter(
      (candidate) => candidate.confidence >= thresholds.review && candidate.confidence < thresholds.positive
    ),
    rejectedCandidates: scoredCandidates.filter((candidate) => candidate.confidence < thresholds.review),
    thresholds
  };
}

export function parseCandidateModelThresholds(value: unknown): CandidateModelThresholds | null {
  if (!isRecord(value)) return null;
  const positive = value.positive;
  const review = value.review;
  if (!isProbability(positive) || !isProbability(review) || review > positive) return null;
  return { positive, review };
}

function parseBoundaryCalibration(value: unknown): BoundaryCalibrationArtifact | null {
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.bySource)) return null;
  const global = value.global === undefined ? undefined : parseBoundaryCalibrationProfile(value.global);
  if (value.global !== undefined && !global) return null;
  const bySourceEntries = Object.entries(value.bySource);
  const bySource: Record<string, BoundaryCalibrationProfile> = {};
  for (const [source, rawProfile] of bySourceEntries) {
    const profile = parseBoundaryCalibrationProfile(rawProfile);
    if (!source.trim() || !profile) return null;
    bySource[source] = profile;
  }
  if (!global && bySourceEntries.length === 0) return null;
  return { version: 1, ...(global ? { global } : {}), bySource };
}

function parseBoundaryCalibrationProfile(value: unknown): BoundaryCalibrationProfile | null {
  if (!isRecord(value)) return null;
  const required = [
    value.startOffsetSeconds,
    value.trainingExamples,
    value.validationExamples,
    value.videoGroups,
    value.baselineMaeSeconds,
    value.calibratedMaeSeconds
  ];
  if (!required.every(isFiniteNumber)) return null;
  if (Math.abs(value.startOffsetSeconds as number) > 30) return null;
  if (value.endOffsetSeconds !== undefined && (!isFiniteNumber(value.endOffsetSeconds) || Math.abs(value.endOffsetSeconds) > 30)) return null;
  if (
    (value.trainingExamples as number) < 1
    || (value.validationExamples as number) < 1
    || (value.videoGroups as number) < 1
    || (value.baselineMaeSeconds as number) < 0
    || (value.calibratedMaeSeconds as number) < 0
    || (value.calibratedMaeSeconds as number) >= (value.baselineMaeSeconds as number)
  ) return null;
  return value as unknown as BoundaryCalibrationProfile;
}

function fallbackCandidateModelThresholds(): CandidateModelThresholds {
  return {
    positive: HEURISTIC_DISPLAY_THRESHOLD,
    review: HEURISTIC_DISPLAY_THRESHOLD
  };
}

function sigmoid(value: number): number {
  return 1 / (1 + Math.exp(-value));
}

function round(value: number): number {
  return Number(value.toFixed(6));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isProbability(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0 && value <= 1;
}

function isFiniteNumberRecord(value: unknown): value is Record<string, number> {
  if (!isRecord(value)) return false;
  return Object.values(value).every(isFiniteNumber);
}

export type { CandidateFeatureVector };
