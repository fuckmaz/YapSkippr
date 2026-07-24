import { expect, test } from 'vitest';
import { buildFeedbackDeduplicationKey } from '../src/feedback/deduplication';
import { feedbackFixture } from './fixtures';

test('builds stable semantic feedback keys independent of transport metadata', () => {
  const first = buildFeedbackDeduplicationKey(feedbackFixture({
    createdAt: '2026-07-24T10:00:00.000Z'
  }));
  const retry = buildFeedbackDeduplicationKey(feedbackFixture({
    createdAt: '2026-07-24T10:05:00.000Z',
    modelVersion: 'newer-transport-snapshot'
  }));

  expect(first).toBe(retry);
  expect(first).toMatch(/^feedback-v1-[a-f0-9]{64}$/);
});

test('keeps distinct labels and corrected segment boundaries independent', () => {
  const original = feedbackFixture({ startSeconds: 42, endSeconds: 90 });
  expect(buildFeedbackDeduplicationKey({
    ...original,
    feedback: 'false_positive'
  })).not.toBe(buildFeedbackDeduplicationKey(original));
  expect(buildFeedbackDeduplicationKey({
    ...original,
    endSeconds: 95
  })).not.toBe(buildFeedbackDeduplicationKey(original));
});

test('does not deduplicate legacy payloads without a stable client identity', () => {
  const payload = feedbackFixture();
  delete payload.clientId;
  expect(buildFeedbackDeduplicationKey(payload)).toBeNull();
  expect(buildFeedbackDeduplicationKey(feedbackFixture({
    videoId: null,
    videoUrl: null
  }))).toBeNull();
});
