import type { EvidenceKind, EvidenceSource } from './types';

export type OccurrenceFeedbackValue = 'accurate' | 'false_positive' | 'wrong_timing' | 'missed_context';
export type OccurrenceFeedbackType = 'candidate' | 'evidence';

export interface OccurrenceFeedbackEvidenceSnapshot {
  source: EvidenceSource | string;
  kind: EvidenceKind | string;
  startSeconds: number;
  endSeconds?: number;
  confidence: number;
  reason: string;
  detail?: string;
}

export interface OccurrenceFeedbackInput {
  videoUrl: string | null;
  videoId: string | null;
  occurrenceId: string;
  occurrenceType: OccurrenceFeedbackType;
  source?: EvidenceSource | string;
  startSeconds: number;
  summary: string;
  reason?: string;
  feedback: OccurrenceFeedbackValue;
  notes?: string;
  modelId?: string | null;
  modelVersion?: string | null;
  modelSource?: string;
  featureSchemaVersion?: number;
  heuristicConfidence?: number;
  modelConfidence?: number;
  candidateFeatures?: Record<string, number>;
  evidenceSnapshot?: OccurrenceFeedbackEvidenceSnapshot[];
  transcriptContext?: string;
}

export interface OccurrenceFeedbackPayload extends OccurrenceFeedbackInput {
  app: 'YapSkippr';
  version: 2;
  createdAt: string;
}

export function createOccurrenceFeedbackPayload(
  input: OccurrenceFeedbackInput,
  now = Date.now()
): OccurrenceFeedbackPayload {
  return {
    app: 'YapSkippr',
    version: 2,
    ...input,
    createdAt: new Date(now).toISOString()
  };
}

export function normalizeFeedbackEndpoint(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  try {
    const url = new URL(trimmed);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}
