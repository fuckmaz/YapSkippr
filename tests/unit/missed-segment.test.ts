import { expect, test } from 'vitest';
import {
  createMissedSegmentContext,
  formatFeedbackTimecode,
  parseFeedbackTimecode
} from '../../src/core/missed-segment';
import { createFallbackActiveCandidateModel } from '../../src/core/model/active-candidate-model';

test('captures in-range evidence and nearby transcript for a missed segment', () => {
  const context = createMissedSegmentContext({
    startSeconds: 40,
    endSeconds: 80,
    videoDurationSeconds: 300,
    evidence: [
      {
        source: 'frame-visible-link',
        kind: 'ad-read-presence',
        startSeconds: 55,
        confidence: 0.7,
        reason: 'Visible URL.'
      },
      {
        source: 'frame-qr-code',
        kind: 'ad-read-presence',
        startSeconds: 120,
        confidence: 0.8,
        reason: 'Outside segment.'
      }
    ],
    transcriptCues: [
      { startSeconds: 34, durationSeconds: 4, text: 'Lead in.' },
      { startSeconds: 42, durationSeconds: 4, text: 'Get twenty percent off.' },
      { startSeconds: 88, durationSeconds: 2, text: 'Back to the review.' },
      { startSeconds: 100, durationSeconds: 2, text: 'Outside context.' }
    ],
    activeModel: createFallbackActiveCandidateModel('Fallback.')
  });

  expect(context).toMatchObject({
    modelId: null,
    modelVersion: null,
    modelSource: 'fallback',
    heuristicConfidence: 0.7,
    featureSchemaVersion: 2,
    transcriptContext: 'Lead in. Get twenty percent off. Back to the review.',
    evidenceSnapshot: [{
      source: 'frame-visible-link',
      startSeconds: 55
    }],
    candidateFeatures: {
      visibleLinkCount: 1,
      startSeconds: 40,
      durationSeconds: 40
    }
  });
});

test('does not manufacture classifier features for a zero-evidence missed segment', () => {
  const context = createMissedSegmentContext({
    startSeconds: 40,
    endSeconds: 80,
    videoDurationSeconds: 300,
    evidence: [],
    transcriptCues: [{ startSeconds: 45, durationSeconds: 4, text: 'A completely missed sponsor read.' }],
    activeModel: createFallbackActiveCandidateModel('Fallback.')
  });

  expect(context).toEqual({
    modelId: null,
    modelVersion: null,
    modelSource: 'fallback',
    transcriptContext: 'A completely missed sponsor read.'
  });
});

test('parses and formats editable feedback timecodes', () => {
  expect(parseFeedbackTimecode('1:20')).toBe(80);
  expect(parseFeedbackTimecode('1:02:03')).toBe(3723);
  expect(parseFeedbackTimecode('42.5')).toBe(42.5);
  expect(parseFeedbackTimecode('1:75')).toBeNull();
  expect(parseFeedbackTimecode('nope')).toBeNull();
  expect(formatFeedbackTimecode(80)).toBe('1:20');
  expect(formatFeedbackTimecode(3723)).toBe('1:02:03');
});
