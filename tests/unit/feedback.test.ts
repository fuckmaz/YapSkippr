import {
  OCCURRENCE_FEEDBACK_ACTIONS,
  OCCURRENCE_FEEDBACK_MODEL_SOURCE_VALUES,
  OCCURRENCE_FEEDBACK_VALUES,
  createFeedbackEndpointOriginPermission,
  createOccurrenceFeedbackPayload,
  deriveAdminDashboardUrl,
  normalizeFeedbackEndpoint
} from '../../src/core/feedback';

test('keeps per-occurrence actions distinct from first-class missed-segment feedback', () => {
  expect(OCCURRENCE_FEEDBACK_VALUES).toEqual(['accurate', 'false_positive', 'wrong_timing', 'missed_context']);
  expect(new Set(OCCURRENCE_FEEDBACK_ACTIONS.map((action) => action.value)).size).toBe(OCCURRENCE_FEEDBACK_ACTIONS.length);
  expect(OCCURRENCE_FEEDBACK_ACTIONS).toEqual([
    { value: 'accurate', label: 'Correct', title: 'Correct detection' },
    { value: 'false_positive', label: 'Not an ad', title: 'Not an ad read' },
    { value: 'wrong_timing', label: 'Wrong times', title: 'Wrong start or end time' }
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
        endSeconds: 90,
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
    endSeconds: 90,
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
        occurrenceId: 'missed-120-180',
        occurrenceType: 'missed-segment',
        source: 'user-missed-segment',
        startSeconds: 120,
        endSeconds: 180,
        summary: '2:00-3:00 · manually reported missed ad read',
        feedback: 'missed_context'
      },
      2_000
    )
  ).toMatchObject({
    app: 'YapSkippr',
    version: 2,
    occurrenceId: 'missed-120-180',
    occurrenceType: 'missed-segment',
    endSeconds: 180,
    feedback: 'missed_context',
    createdAt: '1970-01-01T00:00:02.000Z'
  });
});

test('derives an admin dashboard URL from a saved feedback endpoint', () => {
  expect(deriveAdminDashboardUrl('https://feedback.example.com/api/v1/feedback')).toBe('https://feedback.example.com/admin');
  expect(deriveAdminDashboardUrl(' http://localhost:8787/api/v1/feedback ')).toBe('http://localhost:8787/admin');
  expect(deriveAdminDashboardUrl('https://example.com/custom/path')).toBe('https://example.com/admin');
});

test('accepts secure feedback endpoints and explicit loopback HTTP development endpoints', () => {
  expect(normalizeFeedbackEndpoint('https://feedback.example.com/api/v1/feedback')).toBe(
    'https://feedback.example.com/api/v1/feedback'
  );
  expect(normalizeFeedbackEndpoint('http://localhost:8787/api/v1/feedback')).toBe(
    'http://localhost:8787/api/v1/feedback'
  );
  expect(normalizeFeedbackEndpoint('http://127.0.0.1:8787/api/v1/feedback')).toBe(
    'http://127.0.0.1:8787/api/v1/feedback'
  );
  expect(normalizeFeedbackEndpoint('http://[::1]:8787/api/v1/feedback')).toBe(
    'http://[::1]:8787/api/v1/feedback'
  );
});

test('rejects remote HTTP, credentials, and lookalike loopback hosts', () => {
  expect(normalizeFeedbackEndpoint('http://feedback.example.com/api/v1/feedback')).toBeNull();
  expect(normalizeFeedbackEndpoint('https://user:secret@feedback.example.com/api/v1/feedback')).toBeNull();
  expect(normalizeFeedbackEndpoint('http://localhost.example.com/api/v1/feedback')).toBeNull();
  expect(normalizeFeedbackEndpoint('http://127.0.0.2/api/v1/feedback')).toBeNull();
  expect(normalizeFeedbackEndpoint('http://localhost./api/v1/feedback')).toBeNull();
});

test('creates a least-privilege optional host request for the endpoint origin', () => {
  expect(createFeedbackEndpointOriginPermission('https://feedback.example.com:8443/api/v1/feedback')).toBe(
    'https://feedback.example.com:8443/*'
  );
  expect(createFeedbackEndpointOriginPermission('http://[::1]:8787/api/v1/feedback')).toBe(
    'http://[::1]:8787/*'
  );
  expect(createFeedbackEndpointOriginPermission('http://feedback.example.com/api/v1/feedback')).toBeNull();
});

test('does not derive an admin dashboard URL from invalid feedback endpoints', () => {
  expect(deriveAdminDashboardUrl('')).toBeNull();
  expect(deriveAdminDashboardUrl(null)).toBeNull();
  expect(deriveAdminDashboardUrl('ftp://feedback.example.com/api/v1/feedback')).toBeNull();
  expect(deriveAdminDashboardUrl('http://feedback.example.com/api/v1/feedback')).toBeNull();
  expect(deriveAdminDashboardUrl('https://user:secret@feedback.example.com/api/v1/feedback')).toBeNull();
  expect(deriveAdminDashboardUrl('not a url')).toBeNull();
});
