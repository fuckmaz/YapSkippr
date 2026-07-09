import { createOccurrenceFeedbackPayload, deriveAdminDashboardUrl } from '../../src/core/feedback';

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
        featureSchemaVersion: 2,
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
    featureSchemaVersion: 2,
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

test('derives an admin dashboard URL from a saved feedback endpoint', () => {
  expect(deriveAdminDashboardUrl('https://feedback.example.com/api/v1/feedback')).toBe('https://feedback.example.com/admin');
  expect(deriveAdminDashboardUrl(' http://localhost:8787/api/v1/feedback ')).toBe('http://localhost:8787/admin');
  expect(deriveAdminDashboardUrl('https://example.com/custom/path')).toBe('https://example.com/admin');
});

test('does not derive an admin dashboard URL from invalid feedback endpoints', () => {
  expect(deriveAdminDashboardUrl('')).toBeNull();
  expect(deriveAdminDashboardUrl(null)).toBeNull();
  expect(deriveAdminDashboardUrl('ftp://feedback.example.com/api/v1/feedback')).toBeNull();
  expect(deriveAdminDashboardUrl('not a url')).toBeNull();
});
