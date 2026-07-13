import {
  OCCURRENCE_FEEDBACK_ACTIONS,
  OCCURRENCE_FEEDBACK_MODEL_SOURCE_VALUES,
  OCCURRENCE_FEEDBACK_VALUES,
  createOccurrenceFeedbackPayload,
  deriveAdminDashboardUrl
} from '../../src/core/feedback';

test('defines popup feedback actions for every supported occurrence feedback value', () => {
  expect(OCCURRENCE_FEEDBACK_ACTIONS.map((action) => action.value)).toEqual(OCCURRENCE_FEEDBACK_VALUES);
  expect(new Set(OCCURRENCE_FEEDBACK_ACTIONS.map((action) => action.value)).size).toBe(OCCURRENCE_FEEDBACK_VALUES.length);
  expect(OCCURRENCE_FEEDBACK_ACTIONS).toEqual([
    { value: 'accurate', label: 'Good', title: 'Correct detection' },
    { value: 'false_positive', label: 'Wrong', title: 'Wrong detection' },
    { value: 'wrong_timing', label: 'Timing', title: 'Wrong timing' },
    { value: 'missed_context', label: 'Context', title: 'Missing context' }
  ]);
});

test('defines closed model source values for feedback payloads', () => {
  expect(OCCURRENCE_FEEDBACK_MODEL_SOURCE_VALUES).toEqual(['bundled', 'downloaded', 'fallback']);
});

test('creates a server feedback payload for a detected occurrence', () => {
  expect(
    createOccurrenceFeedbackPayload(
      {
        clientId: 'client_test-123',
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
    clientId: 'client_test-123',
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

test('creates a v2 payload for missed context feedback', () => {
  expect(
    createOccurrenceFeedbackPayload(
      {
        videoUrl: 'https://www.youtube.com/watch?v=abc123',
        videoId: 'abc123',
        occurrenceId: 'candidate-120',
        occurrenceType: 'candidate',
        startSeconds: 120,
        summary: 'Candidate segment at 2:00',
        feedback: 'missed_context'
      },
      2_000
    )
  ).toMatchObject({
    app: 'YapSkippr',
    version: 2,
    occurrenceId: 'candidate-120',
    occurrenceType: 'candidate',
    feedback: 'missed_context',
    createdAt: '1970-01-01T00:00:02.000Z'
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
