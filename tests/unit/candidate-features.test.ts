import { extractCandidateFeatures, FEATURE_SCHEMA_VERSION } from '../../src/core/model/candidate-features';
import type { SegmentCandidate, TimedEvidence } from '../../src/core/types';

function evidence(overrides: Partial<TimedEvidence>): TimedEvidence {
  return {
    source: 'transcript',
    kind: 'ad-read-start',
    startSeconds: 100,
    confidence: 0.8,
    reason: 'Transcript sponsor start cue: "made possible by".',
    raw: {
      phraseGroupId: 'sponsor-start',
      phrase: 'made possible by',
      text: 'This episode is made possible by Acme.'
    },
    ...overrides
  };
}

function candidate(overrides: Partial<SegmentCandidate> = {}): SegmentCandidate {
  return {
    startSeconds: 100,
    endSeconds: 160,
    confidence: 0.74,
    evidence: [
      evidence({ source: 'transcript', kind: 'ad-read-start', startSeconds: 100, confidence: 0.85 }),
      evidence({ source: 'frame-qr-code', kind: 'ad-read-presence', startSeconds: 108, confidence: 0.9, reason: 'qr' }),
      evidence({ source: 'frame-visible-link', kind: 'ad-read-presence', startSeconds: 112, confidence: 0.72, reason: 'link' }),
      evidence({ source: 'transcript', kind: 'ad-read-end', startSeconds: 160, confidence: 0.7, reason: 'back' })
    ],
    ...overrides
  };
}

test('extracts deterministic feature vectors from segment candidates', () => {
  expect(
    extractCandidateFeatures(candidate(), {
      videoDurationSeconds: 1000,
      transcriptContext: 'This episode is made possible by Acme. Use code yapskippr.'
    })
  ).toEqual({
    schemaVersion: FEATURE_SCHEMA_VERSION,
    features: {
      heuristicConfidence: 0.74,
      evidenceTotal: 4,
      transcriptStartCount: 1,
      transcriptPresenceCount: 0,
      transcriptEndCount: 1,
      qrCount: 1,
      progressBarCount: 0,
      visibleLinkCount: 1,
      maxTranscriptConfidence: 0.85,
      avgTranscriptConfidence: 0.775,
      maxQrConfidence: 0.9,
      avgQrConfidence: 0.9,
      maxProgressBarConfidence: 0,
      avgProgressBarConfidence: 0,
      maxVisibleLinkConfidence: 0.72,
      avgVisibleLinkConfidence: 0.72,
      startSeconds: 100,
      durationSeconds: 60,
      isOpenEnded: 0,
      normalizedVideoPosition: 0.1,
      evidenceTimeSpanSeconds: 60,
      hasTranscriptAndQr: 1,
      hasTranscriptAndVisibleLink: 1,
      hasTranscriptAndProgressBar: 0,
      hasQrAndVisibleLink: 1,
      isFrameOnly: 0,
      isTranscriptOnly: 0,
      matchedPhraseGroupCount: 1,
      sponsorPhraseHitCount: 1,
      callToActionPhraseHitCount: 1,
      nearbyEndCue: 1
    },
    phraseGroupIds: ['sponsor-start']
  });
});
