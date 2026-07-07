import type { FeedbackPayloadV2 } from '../src/feedback/schema';

export function feedbackFixture(overrides: Partial<FeedbackPayloadV2> = {}): FeedbackPayloadV2 {
  return {
    app: 'YapSkippr',
    version: 2,
    createdAt: '2026-07-07T10:00:00.000Z',
    videoUrl: 'https://www.youtube.com/watch?v=abc123',
    videoId: 'abc123',
    occurrenceId: 'candidate-42',
    occurrenceType: 'candidate',
    source: 'transcript',
    startSeconds: 42,
    summary: '0:42-1:30 · 86% · transcript + visible link',
    reason: 'Transcript sponsor start cue: "sponsored by".',
    feedback: 'accurate',
    modelId: 'baseline',
    modelVersion: '2026.07.01',
    modelSource: 'fallback',
    featureSchemaVersion: 1,
    heuristicConfidence: 0.74,
    modelConfidence: 0.82,
    candidateFeatures: {
      heuristicConfidence: 0.74,
      evidenceTotal: 2,
      transcriptStartCount: 1,
      transcriptPresenceCount: 0,
      transcriptEndCount: 0,
      qrCount: 0,
      progressBarCount: 0,
      visibleLinkCount: 1,
      maxTranscriptConfidence: 0.85,
      avgTranscriptConfidence: 0.85,
      maxQrConfidence: 0,
      avgQrConfidence: 0,
      maxProgressBarConfidence: 0,
      avgProgressBarConfidence: 0,
      maxVisibleLinkConfidence: 0.72,
      avgVisibleLinkConfidence: 0.72,
      startSeconds: 42,
      durationSeconds: 48,
      isOpenEnded: 0,
      normalizedVideoPosition: 0.1,
      evidenceTimeSpanSeconds: 6,
      hasTranscriptAndQr: 0,
      hasTranscriptAndVisibleLink: 1,
      hasTranscriptAndProgressBar: 0,
      hasQrAndVisibleLink: 0,
      isFrameOnly: 0,
      isTranscriptOnly: 0,
      matchedPhraseGroupCount: 1,
      sponsorPhraseHitCount: 1,
      callToActionPhraseHitCount: 1,
      nearbyEndCue: 0
    },
    evidenceSnapshot: [
      {
        source: 'transcript',
        kind: 'ad-read-start',
        startSeconds: 42,
        confidence: 0.85,
        reason: 'Transcript sponsor start cue: "sponsored by".',
        detail: 'This video is sponsored by Acme.'
      }
    ],
    transcriptContext: 'This video is sponsored by Acme. Use code YAP.',
    ...overrides
  };
}
