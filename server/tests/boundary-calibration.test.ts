import { describe, expect, test } from 'vitest';
import {
  buildBoundaryTrainingExamples,
  calibrateBoundaryCorrections,
  type BoundaryTrainingExample
} from '../src/model/boundary-calibration';
import type { FeedbackRecord } from '../src/store/types';
import { feedbackFixture } from './fixtures';

describe('boundary calibration', () => {
  test('extracts only reviewed structured wrong-timing corrections', () => {
    const record: FeedbackRecord = {
      id: 'fb-1',
      receivedAt: '2026-07-24T00:00:00.000Z',
      payload: feedbackFixture({ startSeconds: 42, endSeconds: 90, source: 'transcript' }),
      review: {
        id: 'review-1',
        feedbackId: 'fb-1',
        label: 'wrong_timing',
        reviewedAt: '2026-07-24T00:01:00.000Z',
        boundaryCorrection: { startSeconds: 47, endSeconds: 96 }
      }
    };

    expect(buildBoundaryTrainingExamples([record])).toEqual([{
      feedbackId: 'fb-1',
      videoId: 'abc123',
      source: 'transcript',
      predictedStartSeconds: 42,
      predictedEndSeconds: 90,
      correctedStartSeconds: 47,
      correctedEndSeconds: 96
    }]);
    expect(buildBoundaryTrainingExamples([{ ...record, review: { ...record.review!, label: 'positive' } }])).toEqual([]);
  });

  test('ships holdout-proven global and source offsets', () => {
    const examples = Array.from({ length: 30 }, (_, index): BoundaryTrainingExample => ({
      feedbackId: `feedback-${index}`,
      videoId: `video-${index}`,
      source: 'transcript',
      predictedStartSeconds: 100 + index,
      predictedEndSeconds: 160 + index,
      correctedStartSeconds: 105 + index,
      correctedEndSeconds: 166 + index
    }));

    const calibration = calibrateBoundaryCorrections(examples);
    expect(calibration?.global).toMatchObject({
      startOffsetSeconds: 5,
      endOffsetSeconds: 6,
      baselineMaeSeconds: 5.5,
      calibratedMaeSeconds: 0
    });
    expect(calibration?.bySource.transcript).toMatchObject({
      startOffsetSeconds: 5,
      endOffsetSeconds: 6
    });
  });

  test('does not ship offsets without enough distinct-video holdout evidence', () => {
    const examples = Array.from({ length: 20 }, (_, index): BoundaryTrainingExample => ({
      feedbackId: `feedback-${index}`,
      videoId: 'same-video',
      source: 'transcript',
      predictedStartSeconds: 100 + index,
      correctedStartSeconds: 105 + index
    }));

    expect(calibrateBoundaryCorrections(examples)).toBeUndefined();
  });
});
