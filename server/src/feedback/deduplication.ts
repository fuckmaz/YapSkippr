import { createHash } from 'node:crypto';
import type { FeedbackPayloadV2 } from './schema.js';

const DEDUPLICATION_KEY_VERSION = 1;

export function buildFeedbackDeduplicationKey(
  payload: FeedbackPayloadV2
): string | null {
  if (!payload.clientId || (!payload.videoId && !payload.videoUrl)) return null;
  const identity = JSON.stringify({
    version: DEDUPLICATION_KEY_VERSION,
    clientId: payload.clientId,
    video: payload.videoId ?? payload.videoUrl,
    occurrenceId: payload.occurrenceId,
    occurrenceType: payload.occurrenceType,
    source: payload.source ?? null,
    startSeconds: normalizeTime(payload.startSeconds),
    endSeconds: payload.endSeconds === undefined ? null : normalizeTime(payload.endSeconds),
    feedback: payload.feedback
  });
  return `feedback-v${DEDUPLICATION_KEY_VERSION}-${createHash('sha256').update(identity).digest('hex')}`;
}

function normalizeTime(value: number): number {
  return Number(value.toFixed(3));
}
