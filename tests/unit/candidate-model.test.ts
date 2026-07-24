import {
  applyBoundaryCalibration,
  applyModelToCandidate,
  selectCandidateSegments,
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
  expect(validateCandidateModel({ ...model, thresholds: { positive: 0.65 } })).toBeNull();
  expect(validateCandidateModel({ ...model, thresholds: { positive: 0.65, review: 0.7 } })).toBeNull();
  expect(validateCandidateModel({ ...model, thresholds: { positive: 1.1, review: 0.45 } })).toBeNull();
  expect(validateCandidateModel({
    ...model,
    boundaryCalibration: {
      version: 1,
      bySource: {},
      global: {
        startOffsetSeconds: 31,
        trainingExamples: 20,
        validationExamples: 5,
        videoGroups: 10,
        baselineMaeSeconds: 5,
        calibratedMaeSeconds: 2
      }
    }
  })).toBeNull();
});

test('applies source-specific holdout-proven boundary offsets before skipping', () => {
  const candidate: SegmentCandidate = {
    startSeconds: 42,
    endSeconds: 90,
    confidence: 0.8,
    evidence: [{
      source: 'transcript',
      kind: 'ad-read-start',
      startSeconds: 42,
      confidence: 0.8,
      reason: 'Sponsor phrase.'
    }]
  };
  const profile = {
    startOffsetSeconds: 5,
    endOffsetSeconds: 8,
    trainingExamples: 20,
    validationExamples: 5,
    videoGroups: 10,
    baselineMaeSeconds: 8,
    calibratedMaeSeconds: 1
  };

  expect(applyBoundaryCalibration(candidate, {
    version: 1,
    global: { ...profile, startOffsetSeconds: 2, endOffsetSeconds: 2 },
    bySource: { transcript: profile }
  })).toMatchObject({
    startSeconds: 47,
    endSeconds: 98
  });
});

test('refuses a boundary offset that would invert the segment', () => {
  const candidate: SegmentCandidate = {
    startSeconds: 42,
    endSeconds: 45,
    confidence: 0.8,
    evidence: []
  };
  const adjusted = applyBoundaryCalibration(candidate, {
    version: 1,
    global: {
      startOffsetSeconds: 10,
      endOffsetSeconds: -10,
      trainingExamples: 20,
      validationExamples: 5,
      videoGroups: 10,
      baselineMaeSeconds: 8,
      calibratedMaeSeconds: 1
    },
    bySource: {}
  });

  expect(adjusted.startSeconds).toBe(42);
  expect(adjusted.endSeconds).toBe(45);
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

test('uses promoted thresholds to suppress model-negative heuristic candidates', () => {
  const candidate: SegmentCandidate = {
    startSeconds: 42,
    confidence: 0.9,
    evidence: []
  };
  const selection = selectCandidateSegments([candidate], {
    model: {
      ...model,
      intercept: 0,
      weights: {},
      thresholds: { positive: 0.65, review: 0.45 }
    },
    modelSource: 'downloaded'
  });

  expect(selection.displayedCandidates).toEqual([]);
  expect(selection.reviewCandidates).toHaveLength(1);
  expect(selection.reviewCandidates[0]).toMatchObject({
    confidence: 0.5,
    heuristicConfidence: 0.9,
    modelConfidence: 0.5
  });
  expect(selection.thresholds).toEqual({ positive: 0.65, review: 0.45 });
});

test('allows a promoted model to recover a structurally valid weak heuristic candidate', () => {
  const candidate: SegmentCandidate = {
    startSeconds: 42,
    confidence: 0.2,
    evidence: []
  };
  const selection = selectCandidateSegments([candidate], {
    model: {
      ...model,
      intercept: 2,
      weights: {},
      thresholds: { positive: 0.8, review: 0.5 }
    },
    modelSource: 'downloaded'
  });

  expect(selection.displayedCandidates).toHaveLength(1);
  expect(selection.displayedCandidates[0]).toMatchObject({
    confidence: 0.880797,
    heuristicConfidence: 0.2,
    modelConfidence: 0.880797
  });
  expect(selection.reviewCandidates).toEqual([]);
  expect(selection.rejectedCandidates).toEqual([]);
});

test('preserves the heuristic display threshold when no promoted model is loaded', () => {
  const selection = selectCandidateSegments([
    { startSeconds: 10, confidence: 0.39, evidence: [] },
    { startSeconds: 20, confidence: 0.4, evidence: [] }
  ], {
    model: null,
    modelSource: 'fallback'
  });

  expect(selection.displayedCandidates.map((candidate) => candidate.startSeconds)).toEqual([20]);
  expect(selection.reviewCandidates).toEqual([]);
  expect(selection.rejectedCandidates.map((candidate) => candidate.startSeconds)).toEqual([10]);
  expect(selection.thresholds).toEqual({ positive: 0.4, review: 0.4 });
});
