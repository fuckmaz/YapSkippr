import {
  applyModelToCandidate,
  scoreCandidateFeatures,
  validateCandidateModel,
  type CandidateModelArtifact
} from '../../src/core/model/candidate-model';
import { FEATURE_SCHEMA_VERSION } from '../../src/core/model/candidate-features';
import type { SegmentCandidate } from '../../src/core/types';

const model: CandidateModelArtifact = {
  modelId: 'model-local-1',
  modelVersion: '2026.07.07',
  featureSchemaVersion: FEATURE_SCHEMA_VERSION,
  createdAt: '2026-07-07T10:00:00.000Z',
  promotedAt: '2026-07-07T11:00:00.000Z',
  intercept: -1,
  weights: {
    heuristicConfidence: 2,
    transcriptStartCount: 0.4,
    visibleLinkCount: 0.6
  },
  thresholds: {
    positive: 0.65,
    review: 0.45
  },
  metrics: {
    auc: 0.78,
    accuracy: 0.72
  },
  trainingSetSummary: {
    examples: 120,
    positives: 70,
    negatives: 50
  }
};

test('validates compatible candidate model artifacts', () => {
  expect(validateCandidateModel(model)).toEqual(model);
  expect(validateCandidateModel({ ...model, featureSchemaVersion: 999 })).toBeNull();
  expect(validateCandidateModel({ ...model, weights: { nope: Number.NaN } })).toBeNull();
});

test('scores candidate features using logistic weights and intercept', () => {
  expect(
    scoreCandidateFeatures(model, {
      heuristicConfidence: 0.8,
      transcriptStartCount: 1,
      visibleLinkCount: 1,
      ignoredFeature: 100
    })
  ).toBe(0.832018);
});

test('applies model confidence while preserving heuristic fallback metadata', () => {
  const candidate: SegmentCandidate = {
    startSeconds: 42,
    endSeconds: 90,
    confidence: 0.8,
    evidence: [
      {
        source: 'transcript',
        kind: 'ad-read-start',
        startSeconds: 42,
        confidence: 0.8,
        reason: 'Transcript sponsor start cue: "thanks to our sponsor".'
      },
      {
        source: 'frame-visible-link',
        kind: 'ad-read-presence',
        startSeconds: 48,
        confidence: 0.7,
        reason: 'Detected visible HTTP link in sampled video frame.'
      }
    ]
  };

  expect(
    applyModelToCandidate(candidate, {
      model,
      modelSource: 'downloaded',
      videoDurationSeconds: 240,
      transcriptContext: 'Thanks to our sponsor. Visit example.com.'
    })
  ).toMatchObject({
    confidence: 0.832018,
    heuristicConfidence: 0.8,
    modelConfidence: 0.832018,
    modelId: 'model-local-1',
    modelVersion: '2026.07.07',
    modelSource: 'downloaded',
    featureSchemaVersion: FEATURE_SCHEMA_VERSION,
    transcriptContext: 'Thanks to our sponsor. Visit example.com.'
  });

  expect(
    applyModelToCandidate(candidate, {
      model: null,
      modelSource: 'fallback',
      videoDurationSeconds: 240
    })
  ).toMatchObject({
    confidence: 0.8,
    heuristicConfidence: 0.8,
    modelConfidence: undefined,
    modelId: null,
    modelVersion: null,
    modelSource: 'fallback',
    featureSchemaVersion: FEATURE_SCHEMA_VERSION
  });
});
