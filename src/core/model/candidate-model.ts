import {
  FEATURE_SCHEMA_VERSION,
  extractCandidateFeatures,
  type CandidateFeatureVector,
  type ExtractCandidateFeatureOptions
} from './candidate-features';
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
}

export interface ApplyCandidateModelOptions extends ExtractCandidateFeatureOptions {
  model: CandidateModelArtifact | null;
  modelSource: CandidateModelSource;
}

export function validateCandidateModel(value: unknown): CandidateModelArtifact | null {
  if (!isRecord(value)) return null;
  if (typeof value.modelId !== 'string' || !value.modelId.trim()) return null;
  if (typeof value.modelVersion !== 'string' || !value.modelVersion.trim()) return null;
  if (value.featureSchemaVersion !== FEATURE_SCHEMA_VERSION) return null;
  if (typeof value.createdAt !== 'string' || !value.createdAt.trim()) return null;
  if (!isFiniteNumber(value.intercept)) return null;
  if (!isFiniteNumberRecord(value.weights)) return null;
  if (!isFiniteNumberRecord(value.thresholds)) return null;
  if (!isFiniteNumberRecord(value.metrics)) return null;
  if (!isFiniteNumberRecord(value.trainingSetSummary)) return null;

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
    trainingSetSummary: value.trainingSetSummary
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

  return {
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

function isFiniteNumberRecord(value: unknown): value is Record<string, number> {
  if (!isRecord(value)) return false;
  return Object.values(value).every(isFiniteNumber);
}

export type { CandidateFeatureVector };
