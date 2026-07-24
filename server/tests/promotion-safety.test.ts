import { expect, test } from 'vitest';
import {
  evaluateModelPromotionSafety,
  MIN_PROMOTION_CALIBRATION_EXAMPLES
} from '../src/model/promotion-safety';
import type { CandidateModelArtifact } from '../src/model/types';

test('accepts a calibrated high-precision candidate with enough holdout evidence', () => {
  expect(evaluateModelPromotionSafety(model(), null)).toEqual({
    safe: true,
    blockers: []
  });
});

test('blocks uncalibrated and statistically tiny candidate models', () => {
  const safety = evaluateModelPromotionSafety(model({
    thresholdsCalibrated: 0,
    thresholdCalibrationExamples: 4
  }), null);

  expect(safety.safe).toBe(false);
  expect(safety.blockers).toEqual(expect.arrayContaining([
    expect.stringContaining('not calibrated'),
    expect.stringContaining(`at least ${MIN_PROMOTION_CALIBRATION_EXAMPLES.toFixed(3)}`)
  ]));
});

test('blocks quality regressions against the currently promoted model', () => {
  const promoted = model({
    positivePrecision: 0.96,
    positiveRecall: 0.82,
    reviewRecall: 0.98,
    auc: 0.92
  });
  const candidate = model({
    positivePrecision: 0.91,
    positiveRecall: 0.7,
    reviewRecall: 0.9,
    auc: 0.82
  });
  const safety = evaluateModelPromotionSafety(candidate, promoted);

  expect(safety.safe).toBe(false);
  expect(safety.blockers).toEqual(expect.arrayContaining([
    expect.stringContaining('Display precision regresses'),
    expect.stringContaining('Display recall regresses'),
    expect.stringContaining('Review recall regresses'),
    expect.stringContaining('AUC regresses')
  ]));
});

function model(metricOverrides: Record<string, number> = {}): CandidateModelArtifact {
  return {
    modelId: 'model-safe',
    modelVersion: '2026.07.24.000000',
    featureSchemaVersion: 2,
    createdAt: '2026-07-24T00:00:00.000Z',
    promotedAt: null,
    intercept: 0,
    weights: { heuristicConfidence: 1 },
    thresholds: { positive: 0.75, review: 0.5 },
    metrics: {
      validationExamples: 40,
      thresholdsCalibrated: 1,
      thresholdCalibrationExamples: 40,
      thresholdCalibrationPositives: 20,
      thresholdCalibrationNegatives: 20,
      thresholdCalibrationGroups: 10,
      positivePrecision: 0.95,
      positiveRecall: 0.75,
      reviewRecall: 0.98,
      auc: 0.9,
      ...metricOverrides
    },
    trainingSetSummary: {
      examples: 200,
      positives: 100,
      negatives: 100
    }
  };
}
