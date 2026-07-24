import type { CandidateModelArtifact, LabeledTrainingExample } from './types.js';

export interface TrainLogisticModelOptions {
  now?: string;
  iterations?: number;
  learningRate?: number;
  positivePrecisionTarget?: number;
  reviewRecallTarget?: number;
}

export interface ScoredTrainingExample {
  label: 0 | 1;
  score: number;
}

export interface CandidateThresholdCalibration {
  positive: number;
  review: number;
  calibrated: boolean;
  examples: number;
  positives: number;
  negatives: number;
}

export const TRAINING_FEATURE_SCHEMA_VERSION = 2;
export const DEFAULT_POSITIVE_THRESHOLD = 0.65;
export const DEFAULT_REVIEW_THRESHOLD = 0.45;
export const DEFAULT_POSITIVE_PRECISION_TARGET = 0.9;
export const DEFAULT_REVIEW_RECALL_TARGET = 0.95;
const excludedTrainableFeatures = new Set(['startSeconds', 'durationSeconds', 'evidenceTimeSpanSeconds']);

export function trainLogisticModel(
  examples: readonly LabeledTrainingExample[],
  options: TrainLogisticModelOptions = {}
): CandidateModelArtifact {
  const now = options.now ?? new Date().toISOString();
  const trainableFeatures = getTrainableFeatures(examples);
  const { train, validation } = splitTrainingExamples(examples);
  const fitExamples = train.length > 0 ? train : examples;
  const weights = Object.fromEntries(trainableFeatures.map((feature) => [feature, 0])) as Record<string, number>;
  let intercept = 0;
  const iterations = options.iterations ?? 300;
  const learningRate = options.learningRate ?? 0.08;
  const l2 = 0.001;

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    let interceptGradient = 0;
    const gradients = Object.fromEntries(trainableFeatures.map((feature) => [feature, 0])) as Record<string, number>;

    for (const example of fitExamples) {
      const prediction = sigmoid(intercept + dot(weights, example.features));
      const error = prediction - example.label;
      interceptGradient += error;
      for (const feature of trainableFeatures) {
        gradients[feature] += error * (example.features[feature] ?? 0);
      }
    }

    const divisor = Math.max(1, fitExamples.length);
    intercept -= learningRate * (interceptGradient / divisor);
    for (const feature of trainableFeatures) {
      weights[feature] -= learningRate * ((gradients[feature] / divisor) + l2 * weights[feature]);
      weights[feature] = round(weights[feature]);
    }
    intercept = round(intercept);
  }

  const evaluationSet = validation.length > 0 ? validation : examples;
  const scoredEvaluation = scoreExamples(evaluationSet, weights, intercept);
  const scoredCalibration = train.length > 0 ? scoreExamples(validation, weights, intercept) : [];
  const thresholdCalibration = calibrateCandidateThresholds(scoredCalibration, {
    positivePrecisionTarget: options.positivePrecisionTarget,
    reviewRecallTarget: options.reviewRecallTarget
  });
  const positiveMetrics = evaluateScoredExamples(scoredEvaluation, thresholdCalibration.positive);
  const reviewMetrics = evaluateScoredExamples(scoredEvaluation, thresholdCalibration.review);
  const metrics = {
    ...positiveMetrics,
    auc: round(auc(scoredEvaluation)),
    positiveThreshold: thresholdCalibration.positive,
    positivePrecision: positiveMetrics.precision,
    positiveRecall: positiveMetrics.recall,
    positiveF1: positiveMetrics.f1,
    reviewThreshold: thresholdCalibration.review,
    reviewPrecision: reviewMetrics.precision,
    reviewRecall: reviewMetrics.recall,
    reviewF1: reviewMetrics.f1,
    thresholdsCalibrated: thresholdCalibration.calibrated ? 1 : 0,
    thresholdCalibrationExamples: thresholdCalibration.examples,
    thresholdCalibrationPositives: thresholdCalibration.positives,
    thresholdCalibrationNegatives: thresholdCalibration.negatives,
    thresholdCalibrationGroups: new Set(validation.map(trainingGroupKey)).size
  };
  const positives = examples.filter((example) => example.label === 1).length;
  const negatives = examples.length - positives;
  const validationPositives = validation.filter((example) => example.label === 1).length;
  const validationNegatives = validation.length - validationPositives;
  const modelId = `model_${stableHash(`${now}:${examples.map((example) => `${example.id}:${example.label}`).join('|')}`)}`;

  return {
    modelId,
    modelVersion: formatModelVersion(now),
    featureSchemaVersion: TRAINING_FEATURE_SCHEMA_VERSION,
    createdAt: now,
    promotedAt: null,
    intercept: round(intercept),
    weights,
    thresholds: {
      positive: thresholdCalibration.positive,
      review: thresholdCalibration.review
    },
    metrics,
    trainingSetSummary: {
      examples: examples.length,
      trainExamples: train.length,
      validationExamples: validation.length,
      validationPositives,
      validationNegatives,
      validationGroups: new Set(validation.map(trainingGroupKey)).size,
      positives,
      negatives,
      featureCount: trainableFeatures.length,
      thresholdsCalibrated: thresholdCalibration.calibrated ? 1 : 0
    }
  };
}

function getTrainableFeatures(examples: readonly LabeledTrainingExample[]): string[] {
  const names = new Set<string>();
  for (const example of examples) {
    for (const [feature, value] of Object.entries(example.features)) {
      if (!Number.isFinite(value)) continue;
      if (excludedTrainableFeatures.has(feature)) continue;
      names.add(feature);
    }
  }
  return [...names].sort();
}

export function splitTrainingExamples(examples: readonly LabeledTrainingExample[]): {
  train: LabeledTrainingExample[];
  validation: LabeledTrainingExample[];
} {
  const train: LabeledTrainingExample[] = [];
  const validation: LabeledTrainingExample[] = [];
  for (const example of examples) {
    const groupKey = trainingGroupKey(example);
    const bucket = stableHash(groupKey) % 5;
    if (bucket === 0) validation.push(example);
    else train.push(example);
  }
  return { train, validation };
}

function trainingGroupKey(example: LabeledTrainingExample): string {
  return example.videoId
    ? `video:${example.videoId}`
    : `feedback:${example.feedbackId}`;
}

export function calibrateCandidateThresholds(
  scoredExamples: readonly ScoredTrainingExample[],
  options: {
    positivePrecisionTarget?: number;
    reviewRecallTarget?: number;
  } = {}
): CandidateThresholdCalibration {
  const scored = scoredExamples.filter(
    (item) => (item.label === 0 || item.label === 1) && Number.isFinite(item.score)
  ).map((item) => ({
    label: item.label,
    score: clampProbability(item.score)
  }));
  const positives = scored.filter((item) => item.label === 1).length;
  const negatives = scored.length - positives;
  if (positives === 0 || negatives === 0) {
    return {
      positive: DEFAULT_POSITIVE_THRESHOLD,
      review: DEFAULT_REVIEW_THRESHOLD,
      calibrated: false,
      examples: scored.length,
      positives,
      negatives
    };
  }

  const positivePrecisionTarget = clampProbability(
    options.positivePrecisionTarget ?? DEFAULT_POSITIVE_PRECISION_TARGET
  );
  const reviewRecallTarget = clampProbability(
    options.reviewRecallTarget ?? DEFAULT_REVIEW_RECALL_TARGET
  );
  const thresholds = [...new Set(scored.map((item) => round(item.score)))].sort((a, b) => a - b);
  const candidates = thresholds.map((threshold) => ({
    threshold,
    ...evaluateScoredExamples(scored, threshold)
  })).filter((item) => item.predictedPositive > 0);

  const precisionQualified = candidates.filter((item) => item.precision >= positivePrecisionTarget);
  const positiveCandidate = [...(precisionQualified.length > 0 ? precisionQualified : candidates)].sort((left, right) => {
    if (precisionQualified.length > 0) {
      return right.recall - left.recall
        || right.precision - left.precision
        || right.threshold - left.threshold;
    }
    return fBeta(right.precision, right.recall, 0.5) - fBeta(left.precision, left.recall, 0.5)
      || right.precision - left.precision
      || right.recall - left.recall
      || right.threshold - left.threshold;
  })[0];
  const positive = positiveCandidate?.threshold ?? DEFAULT_POSITIVE_THRESHOLD;

  const reviewCandidates = candidates.filter((item) => item.threshold <= positive);
  const recallQualified = reviewCandidates.filter((item) => item.recall >= reviewRecallTarget);
  const reviewCandidate = [...(recallQualified.length > 0 ? recallQualified : reviewCandidates)].sort((left, right) => {
    if (recallQualified.length > 0) {
      return right.precision - left.precision
        || right.recall - left.recall
        || right.threshold - left.threshold;
    }
    return fBeta(right.precision, right.recall, 2) - fBeta(left.precision, left.recall, 2)
      || right.recall - left.recall
      || right.precision - left.precision
      || right.threshold - left.threshold;
  })[0];

  return {
    positive: round(positive),
    review: round(Math.min(positive, reviewCandidate?.threshold ?? DEFAULT_REVIEW_THRESHOLD)),
    calibrated: true,
    examples: scored.length,
    positives,
    negatives
  };
}

function scoreExamples(
  examples: readonly LabeledTrainingExample[],
  weights: Record<string, number>,
  intercept: number
): ScoredTrainingExample[] {
  return examples.map((example) => ({
    label: example.label,
    score: sigmoid(intercept + dot(weights, example.features))
  }));
}

function evaluateScoredExamples(
  scored: readonly ScoredTrainingExample[],
  threshold: number
): {
  validationExamples: number;
  predictedPositive: number;
  accuracy: number;
  precision: number;
  recall: number;
  f1: number;
} {
  let correct = 0;
  let truePositive = 0;
  let falsePositive = 0;
  let falseNegative = 0;

  for (const item of scored) {
    const predicted = item.score >= threshold ? 1 : 0;
    if (predicted === item.label) correct += 1;
    if (predicted === 1 && item.label === 1) truePositive += 1;
    if (predicted === 1 && item.label === 0) falsePositive += 1;
    if (predicted === 0 && item.label === 1) falseNegative += 1;
  }

  const precision = truePositive + falsePositive === 0 ? 0 : truePositive / (truePositive + falsePositive);
  const recall = truePositive + falseNegative === 0 ? 0 : truePositive / (truePositive + falseNegative);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);

  return {
    validationExamples: scored.length,
    predictedPositive: truePositive + falsePositive,
    accuracy: round(scored.length === 0 ? 0 : correct / scored.length),
    precision: round(precision),
    recall: round(recall),
    f1: round(f1)
  };
}

function auc(scored: readonly { label: 0 | 1; score: number }[]): number {
  const positives = scored.filter((item) => item.label === 1);
  const negatives = scored.filter((item) => item.label === 0);
  if (positives.length === 0 || negatives.length === 0) return 0.5;

  let wins = 0;
  for (const positive of positives) {
    for (const negative of negatives) {
      if (positive.score > negative.score) wins += 1;
      else if (positive.score === negative.score) wins += 0.5;
    }
  }
  return wins / (positives.length * negatives.length);
}

function dot(weights: Record<string, number>, features: Record<string, number>): number {
  return Object.entries(weights).reduce((total, [feature, weight]) => total + weight * (features[feature] ?? 0), 0);
}

function sigmoid(value: number): number {
  return 1 / (1 + Math.exp(-value));
}

function fBeta(precision: number, recall: number, beta: number): number {
  if (precision === 0 && recall === 0) return 0;
  const betaSquared = beta * beta;
  return ((1 + betaSquared) * precision * recall) / ((betaSquared * precision) + recall);
}

function clampProbability(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function formatModelVersion(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '1970.01.01.000000';
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0')
  ].join('.') + `.${String(date.getUTCHours()).padStart(2, '0')}${String(date.getUTCMinutes()).padStart(2, '0')}${String(date.getUTCSeconds()).padStart(2, '0')}`;
}

function stableHash(value: string): number {
  let hash = 2166136261;
  for (const char of value) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function round(value: number): number {
  return Number(value.toFixed(6));
}
