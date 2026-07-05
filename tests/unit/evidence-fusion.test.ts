import { buildSegmentCandidates } from '../../src/core/analysis/evidence-fusion';
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

test('creates a low-confidence open candidate from frame-only progress evidence', () => {
  const candidates = buildSegmentCandidates([
    evidence({
      source: 'frame-progress-bar',
      kind: 'ad-read-presence',
      startSeconds: 40,
      confidence: 0.65,
      reason: 'bar'
    })
  ]);

  expect(candidates).toHaveLength(1);
  expect(candidates[0]?.startSeconds).toBe(40);
  expect(candidates[0]?.endSeconds).toBeUndefined();
  expect(candidates[0]?.confidence).toBeLessThan(0.7);
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

test('clusters repeated nearby frame-only evidence into one candidate', () => {
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
      startSeconds: 42,
      confidence: 0.62,
      reason: 'bar'
    }),
    evidence({
      source: 'frame-qr-code',
      kind: 'ad-read-presence',
      startSeconds: 45,
      confidence: 0.85,
      reason: 'qr'
    })
  ]);

  expect(candidates).toHaveLength(1);
  expect(candidates[0]?.startSeconds).toBe(40);
  expect(candidates[0]?.evidence).toHaveLength(3);
  expect(candidates[0]?.confidence).toBeGreaterThan(0.65);
});

test('keeps distant frame-only evidence as separate candidates', () => {
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

  expect(candidates).toHaveLength(2);
  expect(candidates.map((candidate) => candidate.startSeconds)).toEqual([40, 95]);
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
