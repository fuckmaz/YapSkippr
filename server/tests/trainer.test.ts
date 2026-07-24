import { expect, test } from 'vitest';
import {
  calibrateCandidateThresholds,
  splitTrainingExamples,
  trainLogisticModel
} from '../src/model/trainer';
import type { LabeledTrainingExample } from '../src/model/types';
import { feedbackFixture } from './fixtures';

test('trains deterministic JSON model artifacts from labeled fixtures', () => {
  const examples = [
    {
      id: 'example-1',
      feedbackId: 'feedback-1',
      videoId: 'video-a',
      occurrenceId: 'candidate-positive',
      label: 1,
      features: feedbackFixture({ occurrenceId: 'candidate-positive' }).candidateFeatures
    },
    {
      id: 'example-2',
      feedbackId: 'feedback-2',
      videoId: 'video-b',
      occurrenceId: 'candidate-negative',
      label: 0,
      features: {
        ...feedbackFixture().candidateFeatures,
        transcriptStartCount: 0,
        visibleLinkCount: 1,
        sponsorPhraseHitCount: 0
      }
    }
  ];

  const first = trainLogisticModel(examples, { now: '2026-07-07T10:00:00.000Z' });
  const second = trainLogisticModel(examples, { now: '2026-07-07T10:00:00.000Z' });

  expect(first).toEqual(second);
  expect(first.modelId).toMatch(/^model_/);
  expect(first.featureSchemaVersion).toBe(2);
  expect(first.trainingSetSummary).toMatchObject({
    examples: 2,
    positives: 1,
    negatives: 1
  });
  expect(first.metrics).toMatchObject({
    accuracy: expect.any(Number),
    validationExamples: expect.any(Number),
    positiveThreshold: 0.65,
    reviewThreshold: 0.45,
    thresholdsCalibrated: 0
  });
});

test('calibrates a precision-first display threshold and a recall-first review threshold', () => {
  const calibration = calibrateCandidateThresholds([
    { label: 0, score: 0.1 },
    { label: 0, score: 0.2 },
    { label: 1, score: 0.6 },
    { label: 0, score: 0.7 },
    { label: 1, score: 0.8 },
    { label: 1, score: 0.9 }
  ]);

  expect(calibration).toEqual({
    positive: 0.8,
    review: 0.6,
    calibrated: true,
    examples: 6,
    positives: 3,
    negatives: 3
  });
});

test('keeps conservative defaults when holdout calibration lacks either class', () => {
  expect(calibrateCandidateThresholds([
    { label: 1, score: 0.7 },
    { label: 1, score: 0.9 }
  ])).toMatchObject({
    positive: 0.65,
    review: 0.45,
    calibrated: false
  });
});

test('keeps every video entirely in train or validation to prevent holdout leakage', () => {
  const examples: LabeledTrainingExample[] = Array.from({ length: 40 }, (_, index) => ({
    id: `example-${index}`,
    feedbackId: `feedback-${index}`,
    videoId: `video-${Math.floor(index / 2)}`,
    occurrenceId: `candidate-${index}`,
    label: index % 2 === 0 ? 1 : 0,
    featureSchemaVersion: 2,
    features: { heuristicConfidence: index / 40 }
  }));
  const split = splitTrainingExamples(examples);
  const trainVideos = new Set(split.train.map((example) => example.videoId));
  const validationVideos = new Set(split.validation.map((example) => example.videoId));

  expect(split.validation.length).toBeGreaterThan(0);
  expect([...trainVideos].filter((videoId) => validationVideos.has(videoId))).toEqual([]);
  expect(split.train.length + split.validation.length).toBe(examples.length);
});
