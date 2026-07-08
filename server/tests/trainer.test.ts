import { expect, test } from 'vitest';
import { trainLogisticModel } from '../src/model/trainer';
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
  expect(first.featureSchemaVersion).toBe(1);
  expect(first.trainingSetSummary).toMatchObject({
    examples: 2,
    positives: 1,
    negatives: 1
  });
  expect(first.metrics).toMatchObject({
    accuracy: expect.any(Number),
    validationExamples: expect.any(Number)
  });
});
