import {
  evaluateSegmentBenchmarkThresholds,
  formatSegmentBenchmarkReport,
  runHeuristicSegmentBenchmark,
  type SegmentBenchmarkThresholds
} from '../../src/core/evaluation/segment-benchmark';
import { SEGMENT_DETECTION_CORPUS } from '../fixtures/segment-detection-corpus';

const QUALITY_GATES: SegmentBenchmarkThresholds = {
  minimumPrecision: 0.95,
  minimumRecall: 0.9,
  minimumNegativeCaseAccuracy: 0.95,
  minimumClosedBoundaryRate: 0.8,
  maximumFalsePositivesPerHour: 0,
  maximumBoundaryMaeSeconds: 5
};

test('end-to-end segment corpus meets detection and boundary quality gates', () => {
  const result = runHeuristicSegmentBenchmark(SEGMENT_DETECTION_CORPUS);
  const report = formatSegmentBenchmarkReport(result);

  expect(evaluateSegmentBenchmarkThresholds(result, QUALITY_GATES), report).toEqual([]);
});

test('matches duplicate detections one-to-one instead of inflating recall', () => {
  const result = runHeuristicSegmentBenchmark([
    {
      id: 'duplicate-candidate-accounting',
      title: 'Duplicate candidates',
      durationSeconds: 300,
      transcriptCues: [],
      supportingEvidence: [
        {
          source: 'frame-visible-link',
          kind: 'ad-read-presence',
          startSeconds: 100,
          confidence: 0.72,
          reason: 'first visible link',
          raw: { text: 'https://sponsor.example/offer-a' }
        },
        {
          source: 'frame-visible-link',
          kind: 'ad-read-presence',
          startSeconds: 130,
          confidence: 0.72,
          reason: 'second visible link',
          raw: { text: 'https://sponsor.example/offer-b' }
        }
      ],
      expectedSegments: [{ startSeconds: 100, endSeconds: 160 }],
      tags: ['accounting'],
      provenance: 'Self-authored benchmark accounting fixture.'
    }
  ]);

  expect(result.metrics).toMatchObject({
    expectedSegments: 1,
    detectedSegments: 2,
    matchedSegments: 1,
    falsePositives: 1,
    recall: 1,
    precision: 0.5
  });
});

test('reports missing closed boundaries separately from segment recall', () => {
  const result = runHeuristicSegmentBenchmark([
    {
      id: 'open-candidate-accounting',
      title: 'Open candidate',
      durationSeconds: 300,
      transcriptCues: [],
      supportingEvidence: [
        {
          source: 'frame-qr-code',
          kind: 'ad-read-presence',
          startSeconds: 100,
          confidence: 0.85,
          reason: 'sponsor QR',
          raw: {
            value: 'https://sponsor.example/offer',
            signal: 'sponsor-cta'
          }
        }
      ],
      expectedSegments: [{ startSeconds: 100, endSeconds: 160 }],
      tags: ['accounting'],
      provenance: 'Self-authored benchmark accounting fixture.'
    }
  ]);

  expect(result.metrics).toMatchObject({
    matchedSegments: 1,
    recall: 1,
    closedBoundaryRate: 0,
    boundaryMaeSeconds: null
  });
});
