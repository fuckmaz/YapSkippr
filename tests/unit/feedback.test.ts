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
        notes: 'The link was part of the channel watermark.',
        modelId: 'model-local-1',
        modelVersion: '2026.07.07',
        modelSource: 'downloaded',
        featureSchemaVersion: 1,
        heuristicConfidence: 0.72,
        modelConfidence: 0.31,
        candidateFeatures: {
          heuristicConfidence: 0.72,
          visibleLinkCount: 1,
          transcriptStartCount: 0
        },
        evidenceSnapshot: [
          {
            source: 'frame-visible-link',
            kind: 'ad-read-presence',
            startSeconds: 42,
            confidence: 0.72,
            reason: 'Detected visible HTTP link in sampled video frame.',
            detail: 'https://brand.example/deal'
          }
        ],
        transcriptContext: 'Before the segment. The ad read starts here. After the segment.'
      },
      1_000
    )
  ).toEqual({
    app: 'YapSkippr',
    version: 2,
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
    modelId: 'model-local-1',
    modelVersion: '2026.07.07',
    modelSource: 'downloaded',
    featureSchemaVersion: 1,
    heuristicConfidence: 0.72,
    modelConfidence: 0.31,
    candidateFeatures: {
      heuristicConfidence: 0.72,
      visibleLinkCount: 1,
      transcriptStartCount: 0
    },
    evidenceSnapshot: [
      {
        source: 'frame-visible-link',
        kind: 'ad-read-presence',
        startSeconds: 42,
        confidence: 0.72,
        reason: 'Detected visible HTTP link in sampled video frame.',
        detail: 'https://brand.example/deal'
      }
    ],
    transcriptContext: 'Before the segment. The ad read starts here. After the segment.',
    createdAt: '1970-01-01T00:00:01.000Z'
  });
});
