import { formatCandidateSummary } from '../../src/ui/candidate-summary';
import type { SegmentCandidate } from '../../src/core/types';

function candidate(overrides: Partial<SegmentCandidate> = {}): SegmentCandidate {
  return {
    startSeconds: 72,
    endSeconds: 132,
    confidence: 0.86,
    evidence: [
      {
        source: 'transcript',
        kind: 'ad-read-start',
        startSeconds: 72,
        confidence: 0.85,
        reason: 'sponsor'
      },
      {
        source: 'frame-qr-code',
        kind: 'ad-read-presence',
        startSeconds: 80,
        confidence: 0.9,
        reason: 'qr'
      }
    ],
    ...overrides
  };
}

test('formats bounded candidate segment with confidence and sources', () => {
  expect(formatCandidateSummary(candidate())).toBe('1:12-2:12 · 86% · transcript + QR');
});

test('formats open candidate segment without an end time', () => {
  expect(formatCandidateSummary(candidate({ endSeconds: undefined }))).toBe('1:12-? · 86% · transcript + QR');
});

test('deduplicates and orders evidence source labels', () => {
  expect(
    formatCandidateSummary(
      candidate({
        evidence: [
          {
            source: 'frame-progress-bar',
            kind: 'ad-read-presence',
            startSeconds: 72,
            confidence: 0.55,
            reason: 'bar'
          },
          {
            source: 'frame-visible-link',
            kind: 'ad-read-presence',
            startSeconds: 80,
            confidence: 0.72,
            reason: 'link'
          },
          {
            source: 'transcript',
            kind: 'ad-read-start',
            startSeconds: 72,
            confidence: 0.85,
            reason: 'sponsor'
          },
          {
            source: 'transcript',
            kind: 'ad-read-end',
            startSeconds: 132,
            confidence: 0.7,
            reason: 'back'
          }
        ]
      })
    )
  ).toBe('1:12-2:12 · 86% · transcript + visible link + progress bar');
});
