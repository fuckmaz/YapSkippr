import { TRAINING_FEATURE_SCHEMA_VERSION } from './trainer.js';
import type { FeedbackRecord, ReviewLabel } from '../store/types.js';

export interface TrainingDatasetRow {
  feedbackId: string;
  occurrenceId: string;
  videoId: string | null;
  source: string;
  startSeconds: number;
  receivedAt: string;
  reviewedAt: string | null;
  reviewLabel: ReviewLabel | null;
  trainingLabel: 0 | 1 | null;
  featureSchemaVersion: number | null;
  featureCount: number;
  compatible: boolean;
  trainable: boolean;
  exclusionReason: string | null;
  boundaryCorrection: {
    startSeconds: number;
    endSeconds?: number;
  } | null;
  startOffsetSeconds: number | null;
  endOffsetSeconds: number | null;
  boundaryTrainable: boolean;
}

export function buildTrainingDatasetRows(
  feedback: readonly FeedbackRecord[],
  activeFeatureSchemaVersion = TRAINING_FEATURE_SCHEMA_VERSION
): TrainingDatasetRow[] {
  return feedback.map((record) => {
    const reviewLabel = record.review?.label ?? null;
    const trainingLabel = reviewLabel ? toTrainingLabel(reviewLabel) : null;
    const featureSchemaVersion = record.payload.featureSchemaVersion ?? null;
    const featureCount = Object.keys(record.payload.candidateFeatures ?? {}).length;
    const compatible = featureSchemaVersion === activeFeatureSchemaVersion;
    const exclusionReason = getExclusionReason({
      reviewLabel,
      trainingLabel,
      featureSchemaVersion,
      featureCount,
      compatible,
      activeFeatureSchemaVersion
    });
    const boundaryCorrection = record.review?.label === 'wrong_timing'
      ? record.review.boundaryCorrection ?? null
      : null;

    return {
      feedbackId: record.id,
      occurrenceId: record.payload.occurrenceId,
      videoId: record.payload.videoId,
      source: record.payload.source ?? record.payload.occurrenceType,
      startSeconds: record.payload.startSeconds,
      receivedAt: record.receivedAt,
      reviewedAt: record.review?.reviewedAt ?? null,
      reviewLabel,
      trainingLabel,
      featureSchemaVersion,
      featureCount,
      compatible,
      trainable: exclusionReason === null,
      exclusionReason,
      boundaryCorrection,
      startOffsetSeconds: boundaryCorrection
        ? round(boundaryCorrection.startSeconds - record.payload.startSeconds)
        : null,
      endOffsetSeconds: boundaryCorrection?.endSeconds !== undefined && record.payload.endSeconds !== undefined
        ? round(boundaryCorrection.endSeconds - record.payload.endSeconds)
        : null,
      boundaryTrainable: boundaryCorrection !== null
    };
  });
}

function round(value: number): number {
  return Number(value.toFixed(3));
}

function getExclusionReason({
  reviewLabel,
  trainingLabel,
  featureSchemaVersion,
  featureCount,
  compatible,
  activeFeatureSchemaVersion
}: {
  reviewLabel: ReviewLabel | null;
  trainingLabel: 0 | 1 | null;
  featureSchemaVersion: number | null;
  featureCount: number;
  compatible: boolean;
  activeFeatureSchemaVersion: number;
}): string | null {
  if (!reviewLabel) return 'Feedback has not been reviewed yet.';
  if (featureCount === 0) return 'Feedback payload does not include candidate features.';
  if (trainingLabel === null) return nonTrainableLabelReason(reviewLabel);
  if (!compatible) return `Feature schema ${featureSchemaVersion ?? 'unknown'} is not compatible with active schema ${activeFeatureSchemaVersion}.`;
  return null;
}

function nonTrainableLabelReason(label: ReviewLabel): string {
  if (label === 'wrong_timing') return 'wrong_timing is stored for boundary analysis, not confidence training.';
  if (label === 'needs_more_data') return 'needs_more_data is stored for investigation, not confidence training.';
  return `${label} is not used for confidence training.`;
}

function toTrainingLabel(label: ReviewLabel): 0 | 1 | null {
  if (label === 'positive') return 1;
  if (label === 'false_positive' || label === 'duplicate' || label === 'ignored') return 0;
  return null;
}
