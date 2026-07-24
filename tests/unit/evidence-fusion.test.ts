import {
  buildSegmentCandidatePool,
  buildSegmentCandidates
} from '../../src/core/analysis/evidence-fusion';
import type { TimedEvidence } from '../../src/core/types';

function evidence(overrides: Partial<TimedEvidence>): TimedEvidence {
  return {
    source: 'transcript',
    kind: 'ad-read-start',
    startSeconds: 0,
    confidence: 0.8,
    reason: 'test',
    ...overrides
  };
}

test('builds a bounded candidate from transcript start and end evidence', () => {
  const candidates = buildSegmentCandidates([
    evidence({ kind: 'ad-read-start', startSeconds: 15, confidence: 0.85 }),
    evidence({ kind: 'ad-read-end', startSeconds: 75, confidence: 0.7 })
  ]);

  expect(candidates).toHaveLength(1);
  expect(candidates[0]).toMatchObject({
    startSeconds: 15,
    endSeconds: 75
  });
  expect(candidates[0]?.confidence).toBeGreaterThan(0.7);
});

test('increases confidence when QR evidence appears near transcript start', () => {
  const withoutQr = buildSegmentCandidates([
    evidence({ kind: 'ad-read-start', startSeconds: 15, confidence: 0.65 })
  ]);
  const withQr = buildSegmentCandidates([
    evidence({ kind: 'ad-read-start', startSeconds: 15, confidence: 0.65 }),
    evidence({
      source: 'frame-qr-code',
      kind: 'ad-read-presence',
      startSeconds: 22,
      confidence: 0.85,
      reason: 'qr'
    })
  ]);

  expect(withQr[0]?.confidence).toBeGreaterThan(withoutQr[0]?.confidence ?? 0);
});

test('filters isolated frame-only progress evidence below display threshold', () => {
  const candidates = buildSegmentCandidates([
    evidence({
      source: 'frame-progress-bar',
      kind: 'ad-read-presence',
      startSeconds: 40,
      confidence: 0.65,
      reason: 'bar'
    })
  ]);

  expect(candidates).toEqual([]);
});

test('does not fuse repeated generic transcript calls to action without corroboration', () => {
  const candidates = buildSegmentCandidates([
    evidence({
      kind: 'ad-read-presence',
      startSeconds: 40,
      confidence: 0.5,
      reason: 'visit'
    }),
    evidence({
      kind: 'ad-read-presence',
      startSeconds: 52,
      confidence: 0.5,
      reason: 'check out'
    })
  ]);

  expect(candidates).toEqual([]);
});

test('allows transcript call-to-action evidence when a different detector corroborates it', () => {
  const candidates = buildSegmentCandidates([
    evidence({
      kind: 'ad-read-presence',
      startSeconds: 40,
      confidence: 0.5,
      reason: 'use code'
    }),
    evidence({
      source: 'frame-progress-bar',
      kind: 'ad-read-presence',
      startSeconds: 44,
      confidence: 0.78,
      reason: 'confirmed progress'
    })
  ]);

  expect(candidates).toHaveLength(1);
});

test('surfaces isolated sponsor-semantic QR evidence above the display threshold', () => {
  const candidates = buildSegmentCandidates([
    evidence({
      source: 'frame-qr-code',
      kind: 'ad-read-presence',
      startSeconds: 40,
      confidence: 0.85,
      reason: 'qr',
      raw: { value: 'https://sponsor.example/offer', signal: 'sponsor-cta' }
    })
  ]);

  expect(candidates).toHaveLength(1);
  expect(candidates[0]?.startSeconds).toBe(40);
  expect(candidates[0]?.confidence).toBeGreaterThanOrEqual(0.4);
});

test('does not surface a generic decoded HTTP QR without corroboration', () => {
  const candidates = buildSegmentCandidates([
    evidence({
      source: 'frame-qr-code',
      kind: 'ad-read-presence',
      startSeconds: 40,
      confidence: 0.85,
      reason: 'ordinary QR URL',
      raw: { value: 'https://www.wikipedia.org/wiki/QR_code', signal: 'low-signal', payloadType: 'url' }
    })
  ]);

  expect(candidates).toEqual([]);
});

test('allows persistent generic QR evidence after three independent sampled observations', () => {
  const candidates = buildSegmentCandidates([40, 48, 56].map((startSeconds) => evidence({
    source: 'frame-qr-code',
    kind: 'ad-read-presence',
    startSeconds,
    confidence: 0.32,
    reason: 'persistent ordinary QR URL',
    raw: { value: 'https://www.wikipedia.org/wiki/QR_code', signal: 'low-signal', payloadType: 'url' }
  })));

  expect(candidates).toHaveLength(1);
  expect(candidates[0]?.confidence).toBeCloseTo(0.48);
});

test('coalesces duplicate QR frames before scoring', () => {
  const candidates = buildSegmentCandidates([
    evidence({
      source: 'frame-qr-code',
      kind: 'ad-read-presence',
      startSeconds: 40,
      confidence: 0.85,
      reason: 'qr',
      raw: { value: 'https://sponsor.example/offer', signal: 'sponsor-cta' }
    }),
    evidence({
      source: 'frame-qr-code',
      kind: 'ad-read-presence',
      startSeconds: 44,
      confidence: 0.9,
      reason: 'same qr',
      raw: { value: 'https://sponsor.example/offer', signal: 'sponsor-cta' }
    })
  ]);

  expect(candidates).toHaveLength(1);
  expect(candidates[0]?.evidence).toHaveLength(1);
  expect(candidates[0]?.confidence).toBeLessThan(0.5);
});

test('does not inflate confidence from duplicate frame-only progress evidence', () => {
  const candidates = buildSegmentCandidates([
    evidence({
      source: 'frame-progress-bar',
      kind: 'ad-read-presence',
      startSeconds: 40,
      confidence: 0.65,
      reason: 'bar',
      raw: { frameWidth: 960, frameHeight: 540, trackStartX: 10, trackEndX: 800, y: 120, rows: 2, fillRatio: 0.25 }
    }),
    evidence({
      source: 'frame-progress-bar',
      kind: 'ad-read-presence',
      startSeconds: 43,
      confidence: 0.65,
      reason: 'same bar',
      raw: { frameWidth: 960, frameHeight: 540, trackStartX: 10, trackEndX: 800, y: 121, rows: 2, fillRatio: 0.26 }
    })
  ]);

  expect(candidates).toEqual([]);
});

test('never surfaces detector-realistic moving progress output without corroboration', () => {
  const candidates = buildSegmentCandidates([
    evidence({
      source: 'frame-progress-bar',
      kind: 'ad-read-presence',
      startSeconds: 40,
      confidence: 0.78,
      reason: 'Confirmed a changing horizontal progress bar across consecutive video frames.',
      raw: {
        frameWidth: 960,
        frameHeight: 540,
        trackStartX: 120,
        trackEndX: 840,
        startX: 120,
        endX: 480,
        y: 180,
        rows: 3,
        fillRatio: 0.5007,
        temporalObservations: 2,
        fillDelta: 0.12
      }
    })
  ]);

  expect(candidates).toEqual([]);
});

test('creates an open candidate from visible link evidence', () => {
  const candidates = buildSegmentCandidates([
    evidence({
      source: 'frame-visible-link',
      kind: 'ad-read-presence',
      startSeconds: 55,
      confidence: 0.72,
      reason: 'visible link'
    })
  ]);

  expect(candidates).toHaveLength(1);
  expect(candidates[0]?.startSeconds).toBe(55);
  expect(candidates[0]?.confidence).toBeGreaterThan(0.4);
});

test('defaults a high-confidence open candidate to two minutes', () => {
  const candidates = buildSegmentCandidates([
    evidence({ kind: 'ad-read-start', startSeconds: 10, confidence: 0.9 }),
    evidence({
      source: 'frame-qr-code',
      kind: 'ad-read-presence',
      startSeconds: 16,
      confidence: 0.9,
      reason: 'qr'
    })
  ]);

  expect(candidates[0]?.endSeconds).toBe(130);
});

test('filters candidates below the display confidence threshold', () => {
  const candidates = buildSegmentCandidates([
    evidence({
      source: 'frame-progress-bar',
      kind: 'ad-read-presence',
      startSeconds: 40,
      confidence: 0.2,
      reason: 'weak bar'
    })
  ]);

  expect(candidates).toEqual([]);
});

test('keeps structurally valid low-confidence candidates in the model-scoring pool', () => {
  const input = [
    evidence({
      kind: 'ad-read-start',
      startSeconds: 40,
      confidence: 0.2,
      reason: 'weak transcript start'
    })
  ];

  expect(buildSegmentCandidates(input)).toEqual([]);
  expect(buildSegmentCandidatePool(input)).toMatchObject([
    {
      startSeconds: 40,
      confidence: 0.15
    }
  ]);
});

test('clusters repeated nearby frame-only evidence into one candidate', () => {
  const candidates = buildSegmentCandidates([
    evidence({
      source: 'frame-progress-bar',
      kind: 'ad-read-presence',
      startSeconds: 40,
      confidence: 0.65,
      reason: 'bar',
      raw: { frameWidth: 960, frameHeight: 540, trackStartX: 10, trackEndX: 800, y: 120, rows: 2, fillRatio: 0.25 }
    }),
    evidence({
      source: 'frame-progress-bar',
      kind: 'ad-read-presence',
      startSeconds: 42,
      confidence: 0.62,
      reason: 'same bar',
      raw: { frameWidth: 960, frameHeight: 540, trackStartX: 10, trackEndX: 800, y: 121, rows: 2, fillRatio: 0.26 }
    }),
    evidence({
      source: 'frame-qr-code',
      kind: 'ad-read-presence',
      startSeconds: 45,
      confidence: 0.85,
      reason: 'qr',
      raw: { value: 'https://sponsor.example/offer', signal: 'sponsor-cta' }
    })
  ]);

  expect(candidates).toHaveLength(1);
  expect(candidates[0]?.startSeconds).toBe(40);
  expect(candidates[0]?.evidence).toHaveLength(2);
  expect(candidates[0]?.confidence).toBeGreaterThan(0.65);
});

test('filters distant isolated frame-only progress evidence', () => {
  const candidates = buildSegmentCandidates([
    evidence({
      source: 'frame-progress-bar',
      kind: 'ad-read-presence',
      startSeconds: 40,
      confidence: 0.65,
      reason: 'bar'
    }),
    evidence({
      source: 'frame-progress-bar',
      kind: 'ad-read-presence',
      startSeconds: 95,
      confidence: 0.65,
      reason: 'bar'
    })
  ]);

  expect(candidates).toEqual([]);
});

test('keeps separate transcript-led candidates when multiple start cues exist', () => {
  const candidates = buildSegmentCandidates([
    evidence({ kind: 'ad-read-start', startSeconds: 20, confidence: 0.82 }),
    evidence({ kind: 'ad-read-start', startSeconds: 300, confidence: 0.78 }),
    evidence({
      source: 'frame-progress-bar',
      kind: 'ad-read-presence',
      startSeconds: 24,
      confidence: 0.62,
      reason: 'bar'
    })
  ]);

  expect(candidates).toHaveLength(2);
  expect(candidates.map((candidate) => candidate.startSeconds)).toEqual([20, 300]);
  expect(candidates[0]?.evidence).toHaveLength(2);
});
