import type { FeedbackRecord } from '../store/types.js';

export interface BoundaryTrainingExample {
  feedbackId: string;
  videoId: string | null;
  source: string;
  predictedStartSeconds: number;
  predictedEndSeconds?: number;
  correctedStartSeconds: number;
  correctedEndSeconds?: number;
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

const MIN_TRAINING_EXAMPLES = 5;
const MIN_TRAINING_GROUPS = 3;
const MIN_VALIDATION_EXAMPLES = 2;
const MAX_ABSOLUTE_OFFSET_SECONDS = 30;
const MIN_MAE_IMPROVEMENT_SECONDS = 0.25;

export function buildBoundaryTrainingExamples(
  feedback: readonly FeedbackRecord[]
): BoundaryTrainingExample[] {
  return feedback.flatMap((record) => {
    const correction = record.review?.boundaryCorrection;
    if (record.review?.label !== 'wrong_timing' || !correction) return [];
    const predictedStartSeconds = record.payload.startSeconds;
    const predictedEndSeconds = record.payload.endSeconds;
    if (!isValidTime(predictedStartSeconds) || !isValidTime(correction.startSeconds)) return [];

    return [{
      feedbackId: record.id,
      videoId: record.payload.videoId,
      source: calibrationSource(record),
      predictedStartSeconds,
      ...(isValidTime(predictedEndSeconds) ? { predictedEndSeconds } : {}),
      correctedStartSeconds: correction.startSeconds,
      ...(isValidTime(correction.endSeconds) ? { correctedEndSeconds: correction.endSeconds } : {})
    }];
  });
}

export function calibrateBoundaryCorrections(
  examples: readonly BoundaryTrainingExample[]
): BoundaryCalibrationArtifact | undefined {
  const usable = examples.filter(isUsableExample);
  const global = calibrateProfile(usable);
  const bySource = Object.fromEntries(
    [...new Set(usable.map((example) => example.source))]
      .sort()
      .flatMap((source) => {
        const profile = calibrateProfile(usable.filter((example) => example.source === source));
        return profile ? [[source, profile] as const] : [];
      })
  );

  if (!global && Object.keys(bySource).length === 0) return undefined;
  return {
    version: 1,
    ...(global ? { global } : {}),
    bySource
  };
}

function calibrateProfile(
  examples: readonly BoundaryTrainingExample[]
): BoundaryCalibrationProfile | undefined {
  const { training, validation } = splitByVideo(examples);
  const trainingGroups = new Set(training.map(groupKey)).size;
  const validationGroups = new Set(validation.map(groupKey)).size;
  const videoGroups = new Set(examples.map(groupKey)).size;
  if (
    training.length < MIN_TRAINING_EXAMPLES
    || trainingGroups < MIN_TRAINING_GROUPS
    || validation.length < MIN_VALIDATION_EXAMPLES
    || validationGroups < 2
  ) return undefined;

  const startOffsetSeconds = clampOffset(median(training.map(startDelta)));
  const endDeltas = training.flatMap((example) => {
    if (example.predictedEndSeconds === undefined || example.correctedEndSeconds === undefined) return [];
    return [example.correctedEndSeconds - example.predictedEndSeconds];
  });
  const endOffsetSeconds = endDeltas.length >= MIN_TRAINING_EXAMPLES
    ? clampOffset(median(endDeltas))
    : undefined;
  const baselineMaeSeconds = meanAbsoluteError(validation, 0, undefined);
  const calibratedMaeSeconds = meanAbsoluteError(validation, startOffsetSeconds, endOffsetSeconds);
  if (
    !Number.isFinite(baselineMaeSeconds)
    || !Number.isFinite(calibratedMaeSeconds)
    || calibratedMaeSeconds > baselineMaeSeconds - MIN_MAE_IMPROVEMENT_SECONDS
  ) return undefined;

  return {
    startOffsetSeconds: round(startOffsetSeconds),
    ...(endOffsetSeconds === undefined ? {} : { endOffsetSeconds: round(endOffsetSeconds) }),
    trainingExamples: training.length,
    validationExamples: validation.length,
    videoGroups,
    baselineMaeSeconds: round(baselineMaeSeconds),
    calibratedMaeSeconds: round(calibratedMaeSeconds)
  };
}

function splitByVideo(examples: readonly BoundaryTrainingExample[]): {
  training: BoundaryTrainingExample[];
  validation: BoundaryTrainingExample[];
} {
  const training: BoundaryTrainingExample[] = [];
  const validation: BoundaryTrainingExample[] = [];
  for (const example of examples) {
    if (stableHash(groupKey(example)) % 5 === 0) validation.push(example);
    else training.push(example);
  }
  return { training, validation };
}

function meanAbsoluteError(
  examples: readonly BoundaryTrainingExample[],
  startOffsetSeconds: number,
  endOffsetSeconds: number | undefined
): number {
  const errors = examples.flatMap((example) => {
    const values = [
      Math.abs((example.predictedStartSeconds + startOffsetSeconds) - example.correctedStartSeconds)
    ];
    if (
      example.predictedEndSeconds !== undefined
      && example.correctedEndSeconds !== undefined
    ) {
      values.push(Math.abs(
        (example.predictedEndSeconds + (endOffsetSeconds ?? startOffsetSeconds))
          - example.correctedEndSeconds
      ));
    }
    return values;
  });
  return errors.reduce((sum, value) => sum + value, 0) / errors.length;
}

function calibrationSource(record: FeedbackRecord): string {
  if (record.payload.occurrenceType !== 'candidate') {
    return record.payload.source ?? record.payload.occurrenceType;
  }
  const evidence = [...(record.payload.evidenceSnapshot ?? [])].sort((left, right) => {
    const leftStartRank = left.kind === 'ad-read-start' ? 0 : 1;
    const rightStartRank = right.kind === 'ad-read-start' ? 0 : 1;
    return leftStartRank - rightStartRank
      || Math.abs(left.startSeconds - record.payload.startSeconds)
        - Math.abs(right.startSeconds - record.payload.startSeconds);
  });
  return evidence[0]?.source ?? record.payload.source ?? record.payload.occurrenceType;
}

function isUsableExample(example: BoundaryTrainingExample): boolean {
  return isValidTime(example.predictedStartSeconds)
    && isValidTime(example.correctedStartSeconds)
    && Boolean(example.source.trim());
}

function groupKey(example: BoundaryTrainingExample): string {
  return example.videoId ? `video:${example.videoId}` : `feedback:${example.feedbackId}`;
}

function startDelta(example: BoundaryTrainingExample): number {
  return example.correctedStartSeconds - example.predictedStartSeconds;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] ?? 0;
  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

function clampOffset(value: number): number {
  return Math.min(MAX_ABSOLUTE_OFFSET_SECONDS, Math.max(-MAX_ABSOLUTE_OFFSET_SECONDS, value));
}

function stableHash(value: string): number {
  let hash = 2166136261;
  for (const char of value) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function isValidTime(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function round(value: number): number {
  return Number(value.toFixed(6));
}
