import type { ActiveCandidateModelState } from './model/active-candidate-model';
import { extractCandidateFeatures } from './model/candidate-features';
import { scoreCandidateFeatures } from './model/candidate-model';
import type { OccurrenceFeedbackEvidenceSnapshot } from './feedback';
import type { TimedEvidence, TranscriptCue } from './types';

export interface MissedSegmentContextOptions {
  startSeconds: number;
  endSeconds: number;
  videoDurationSeconds: number | null;
  evidence: readonly TimedEvidence[];
  transcriptCues: readonly TranscriptCue[];
  activeModel: ActiveCandidateModelState;
}

export interface MissedSegmentContext {
  evidenceSnapshot?: OccurrenceFeedbackEvidenceSnapshot[];
  transcriptContext?: string;
  featureSchemaVersion?: number;
  heuristicConfidence?: number;
  modelConfidence?: number;
  candidateFeatures?: Record<string, number>;
  modelId: string | null;
  modelVersion: string | null;
  modelSource: ActiveCandidateModelState['modelSource'];
}

const TRANSCRIPT_CONTEXT_WINDOW_SECONDS = 10;
export const MAX_MISSED_SEGMENT_DURATION_SECONDS = 10 * 60;

export function parseFeedbackTimecode(value: string): number | null {
  const parts = value.trim().split(':');
  if (
    parts.length < 1
    || parts.length > 3
    || parts.slice(0, -1).some((part) => !/^\d+$/.test(part))
    || !/^\d+(?:\.\d+)?$/.test(parts.at(-1) ?? '')
  ) {
    return null;
  }
  const numbers = parts.map(Number);
  if (numbers.some((part) => !Number.isFinite(part))) return null;
  if (parts.length > 1 && (numbers.at(-1) ?? 0) >= 60) return null;
  if (parts.length === 3 && (numbers[1] ?? 0) >= 60) return null;
  const seconds = parts.length === 3
    ? (numbers[0] ?? 0) * 3600 + (numbers[1] ?? 0) * 60 + (numbers[2] ?? 0)
    : parts.length === 2
      ? (numbers[0] ?? 0) * 60 + (numbers[1] ?? 0)
      : numbers[0] ?? 0;
  return Number(seconds.toFixed(3));
}

export function formatFeedbackTimecode(seconds: number): string {
  const wholeSeconds = Math.max(0, Math.round(seconds));
  const hours = Math.floor(wholeSeconds / 3600);
  const minutes = Math.floor((wholeSeconds % 3600) / 60);
  const remainingSeconds = wholeSeconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`
    : `${minutes}:${String(remainingSeconds).padStart(2, '0')}`;
}

export function createMissedSegmentContext(
  options: MissedSegmentContextOptions
): MissedSegmentContext {
  const evidence = options.evidence.filter((item) => overlapsRange(
    item.startSeconds,
    item.endSeconds ?? item.startSeconds,
    options.startSeconds,
    options.endSeconds
  ));
  const transcriptContext = options.transcriptCues
    .filter((cue) => overlapsRange(
      cue.startSeconds,
      cue.startSeconds + cue.durationSeconds,
      Math.max(0, options.startSeconds - TRANSCRIPT_CONTEXT_WINDOW_SECONDS),
      options.endSeconds + TRANSCRIPT_CONTEXT_WINDOW_SECONDS
    ))
    .map((cue) => cue.text)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  const model = options.activeModel.model;
  const base = {
    modelId: model?.modelId ?? null,
    modelVersion: model?.modelVersion ?? null,
    modelSource: options.activeModel.modelSource
  };
  if (evidence.length === 0) {
    return {
      ...base,
      ...(transcriptContext ? { transcriptContext } : {})
    };
  }

  const heuristicConfidence = Math.max(...evidence.map((item) => item.confidence));
  const extracted = extractCandidateFeatures({
    startSeconds: options.startSeconds,
    endSeconds: options.endSeconds,
    confidence: heuristicConfidence,
    evidence: [...evidence]
  }, {
    videoDurationSeconds: options.videoDurationSeconds,
    transcriptContext
  });
  const modelConfidence = model
    ? scoreCandidateFeatures(model, extracted.features)
    : undefined;

  return {
    ...base,
    evidenceSnapshot: evidence.map(toEvidenceSnapshot),
    ...(transcriptContext ? { transcriptContext } : {}),
    featureSchemaVersion: extracted.schemaVersion,
    heuristicConfidence,
    ...(modelConfidence === undefined ? {} : { modelConfidence }),
    candidateFeatures: extracted.features
  };
}

function overlapsRange(
  leftStart: number,
  leftEnd: number,
  rightStart: number,
  rightEnd: number
): boolean {
  return leftEnd >= rightStart && leftStart <= rightEnd;
}

function toEvidenceSnapshot(evidence: TimedEvidence): OccurrenceFeedbackEvidenceSnapshot {
  return {
    source: evidence.source,
    kind: evidence.kind,
    startSeconds: evidence.startSeconds,
    ...(evidence.endSeconds === undefined ? {} : { endSeconds: evidence.endSeconds }),
    confidence: evidence.confidence,
    reason: evidence.reason,
    ...(typeof evidence.raw === 'string' ? { detail: evidence.raw } : {})
  };
}
