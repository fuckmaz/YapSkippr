import { TRAINING_FEATURE_SCHEMA_VERSION } from './trainer.js';
import type { LabeledTrainingExample } from './types.js';

export interface TrainingReadinessSummary {
  featureSchemaVersion: number;
  totalExamples: number;
  compatibleExamples: number;
  incompatibleExamples: number;
  positiveExamples: number;
  negativeExamples: number;
  ready: boolean;
  blocker: string | null;
}

export function summarizeTrainingReadiness(
  examples: readonly LabeledTrainingExample[],
  featureSchemaVersion = TRAINING_FEATURE_SCHEMA_VERSION
): TrainingReadinessSummary {
  const compatibleExamples = examples.filter((example) => example.featureSchemaVersion === featureSchemaVersion);
  const positiveExamples = compatibleExamples.filter((example) => example.label === 1).length;
  const negativeExamples = compatibleExamples.length - positiveExamples;
  const blocker = getTrainingBlocker(compatibleExamples.length, positiveExamples, negativeExamples, featureSchemaVersion);

  return {
    featureSchemaVersion,
    totalExamples: examples.length,
    compatibleExamples: compatibleExamples.length,
    incompatibleExamples: examples.length - compatibleExamples.length,
    positiveExamples,
    negativeExamples,
    ready: blocker === null,
    blocker
  };
}

export function getCompatibleTrainingExamples(
  examples: readonly LabeledTrainingExample[],
  featureSchemaVersion = TRAINING_FEATURE_SCHEMA_VERSION
): LabeledTrainingExample[] {
  return examples.filter((example) => example.featureSchemaVersion === featureSchemaVersion);
}

function getTrainingBlocker(
  compatibleExamples: number,
  positiveExamples: number,
  negativeExamples: number,
  featureSchemaVersion: number
): string | null {
  if (compatibleExamples === 0) return `No reviewed training examples are available for feature schema ${featureSchemaVersion}.`;
  if (positiveExamples === 0 || negativeExamples === 0) {
    return `Training requires at least one positive and one negative reviewed example for feature schema ${featureSchemaVersion}.`;
  }
  return null;
}
