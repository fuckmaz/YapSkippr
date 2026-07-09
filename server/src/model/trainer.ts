import type { CandidateModelArtifact, LabeledTrainingExample } from './types.js';

export interface TrainLogisticModelOptions {
  now?: string;
  iterations?: number;
  learningRate?: number;
}

const featureSchemaVersion = 2;
const excludedTrainableFeatures = new Set(['startSeconds', 'durationSeconds', 'evidenceTimeSpanSeconds']);

export function trainLogisticModel(
  examples: readonly LabeledTrainingExample[],
  options: TrainLogisticModelOptions = {}
): CandidateModelArtifact {
  const now = options.now ?? new Date().toISOString();
  const trainableFeatures = getTrainableFeatures(examples);
  const { train, validation } = splitExamples(examples);
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
  const metrics = evaluateExamples(evaluationSet, weights, intercept);
  const positives = examples.filter((example) => example.label === 1).length;
  const negatives = examples.length - positives;
  const modelId = `model_${stableHash(`${now}:${examples.map((example) => `${example.id}:${example.label}`).join('|')}`)}`;

  return {
    modelId,
    modelVersion: formatModelVersion(now),
    featureSchemaVersion,
    createdAt: now,
    promotedAt: null,
    intercept: round(intercept),
    weights,
    thresholds: {
      positive: 0.65,
      review: 0.45
    },
    metrics,
    trainingSetSummary: {
      examples: examples.length,
      trainExamples: train.length,
      validationExamples: validation.length,
      positives,
      negatives,
      featureCount: trainableFeatures.length
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

function splitExamples(examples: readonly LabeledTrainingExample[]): {
  train: LabeledTrainingExample[];
  validation: LabeledTrainingExample[];
} {
  const train: LabeledTrainingExample[] = [];
  const validation: LabeledTrainingExample[] = [];
  for (const example of examples) {
    const bucket = stableHash(`${example.videoId ?? 'unknown'}:${example.occurrenceId}`) % 5;
    if (bucket === 0) validation.push(example);
    else train.push(example);
  }
  return { train, validation };
}

function evaluateExamples(
  examples: readonly LabeledTrainingExample[],
  weights: Record<string, number>,
  intercept: number
): Record<string, number> {
  let correct = 0;
  let truePositive = 0;
  let falsePositive = 0;
  let falseNegative = 0;
  const scored = examples.map((example) => ({
    label: example.label,
    score: sigmoid(intercept + dot(weights, example.features))
  }));

  for (const item of scored) {
    const predicted = item.score >= 0.5 ? 1 : 0;
    if (predicted === item.label) correct += 1;
    if (predicted === 1 && item.label === 1) truePositive += 1;
    if (predicted === 1 && item.label === 0) falsePositive += 1;
    if (predicted === 0 && item.label === 1) falseNegative += 1;
  }

  const precision = truePositive + falsePositive === 0 ? 0 : truePositive / (truePositive + falsePositive);
  const recall = truePositive + falseNegative === 0 ? 0 : truePositive / (truePositive + falseNegative);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);

  return {
    validationExamples: examples.length,
    accuracy: round(examples.length === 0 ? 0 : correct / examples.length),
    precision: round(precision),
    recall: round(recall),
    f1: round(f1),
    auc: round(auc(scored))
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
