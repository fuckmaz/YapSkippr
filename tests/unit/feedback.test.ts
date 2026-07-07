import { createOccurrenceFeedbackPayload } from '../../src/core/feedback';

test('creates a server feedback payload for a detected occurrence', () => {
  expect(
    createOccurrenceFeedbackPayload(
      {
        videoUrl: 'https://www.youtube.com/watch?v=abc123',
        videoId: 'abc123',
        occurrenceId: '200-0-frame-visible-link-42',
        occurrenceType: 'evidence',
        source: 'frame-visible-link',
        startSeconds: 42,
        summary: 'Visible link evidence at 0:42',
        reason: 'Detected visible HTTP link in sampled video frame.',
        feedback: 'false_positive',
        notes: 'The link was part of the channel watermark.'
      },
      1_000
    )
  ).toEqual({
    app: 'YapSkippr',
    version: 1,
    videoUrl: 'https://www.youtube.com/watch?v=abc123',
    videoId: 'abc123',
    occurrenceId: '200-0-frame-visible-link-42',
    occurrenceType: 'evidence',
    source: 'frame-visible-link',
    startSeconds: 42,
    summary: 'Visible link evidence at 0:42',
    reason: 'Detected visible HTTP link in sampled video frame.',
    feedback: 'false_positive',
    notes: 'The link was part of the channel watermark.',
    createdAt: '1970-01-01T00:00:01.000Z'
  });
});
