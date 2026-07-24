import type { SegmentBenchmarkCase } from '../../src/core/evaluation/segment-benchmark';
import type { TimedEvidence, TranscriptCue } from '../../src/core/types';

const SELF_AUTHORED_PROVENANCE =
  'Self-authored, deterministic transcript and evidence fixture; contains no captured creator content.';

export const SEGMENT_DETECTION_CORPUS: readonly SegmentBenchmarkCase[] = [
  {
    id: 'explicit-preroll-sponsor',
    title: 'Explicit sponsor disclosure with call to action and return cue',
    durationSeconds: 600,
    transcriptCues: [
      cue(0, 'Today we are comparing two approaches.'),
      cue(24, "Before we begin, today's sponsor is Acme Vault."),
      cue(32, 'Use code SAMPLE at checkout for a discount.'),
      cue(80, 'Now back to the video and our first comparison.')
    ],
    expectedSegments: [{ startSeconds: 24, endSeconds: 80 }],
    tags: ['positive', 'transcript', 'explicit-boundaries', 'preroll'],
    provenance: SELF_AUTHORED_PROVENANCE
  },
  {
    id: 'split-caption-midroll',
    title: 'Sponsor phrase split across adjacent caption cues',
    durationSeconds: 900,
    transcriptCues: [
      cue(294, 'There is one more constraint to consider.'),
      cue(300, 'This episode is made possible'),
      cue(303, 'by Acme Cloud, which keeps the sample project online.'),
      cue(312, 'Click the link in the description to start a free trial.'),
      cue(365, 'With that out of the way, let us inspect the result.')
    ],
    expectedSegments: [{ startSeconds: 300, endSeconds: 365 }],
    tags: ['positive', 'transcript', 'split-caption', 'midroll'],
    provenance: SELF_AUTHORED_PROVENANCE
  },
  {
    id: 'progress-corroborated-midroll',
    title: 'Transcript start corroborated by a temporally advancing progress bar',
    durationSeconds: 720,
    transcriptCues: [
      cue(150, 'A quick word from Acme Mobile before the next section.'),
      cue(212, "Now let's get back into the walkthrough.")
    ],
    supportingEvidence: [
      progressEvidence(156, 0.24),
      progressEvidence(162, 0.48),
      progressEvidence(168, 0.72)
    ],
    expectedSegments: [{ startSeconds: 150, endSeconds: 212 }],
    tags: ['positive', 'transcript', 'progress-bar', 'cross-modal'],
    provenance: SELF_AUTHORED_PROVENANCE
  },
  {
    id: 'two-distinct-ad-breaks',
    title: 'Two sponsor reads remain separate within one video',
    durationSeconds: 1_200,
    transcriptCues: [
      cue(60, 'This video is brought to you by Acme Audio.'),
      cue(68, 'Go to acme dot example slash audio to learn more.'),
      cue(110, 'Back to the video and the microphone test.'),
      cue(420, 'Thanks to our sponsor Beta Desk for supporting this episode.'),
      cue(428, 'Use code SAMPLE for the limited time offer.'),
      cue(480, 'Anyway, here is the final desk setup.')
    ],
    expectedSegments: [
      { startSeconds: 60, endSeconds: 110 },
      { startSeconds: 420, endSeconds: 480 }
    ],
    tags: ['positive', 'transcript', 'multiple-segments'],
    provenance: SELF_AUTHORED_PROVENANCE
  },
  {
    id: 'semantic-qr-only',
    title: 'Sponsor-semantic QR surfaces a reviewable open segment',
    durationSeconds: 480,
    transcriptCues: [],
    supportingEvidence: [
      {
        source: 'frame-qr-code',
        kind: 'ad-read-presence',
        startSeconds: 250,
        confidence: 0.85,
        reason: 'Detected sponsor-like QR code in sampled video frame.',
        raw: {
          value: 'https://sponsor.example/offer',
          signal: 'sponsor-cta',
          payloadType: 'url'
        }
      }
    ],
    expectedSegments: [{ startSeconds: 250, endSeconds: 310 }],
    tags: ['positive', 'qr-code', 'open-boundary', 'review-only'],
    provenance: SELF_AUTHORED_PROVENANCE
  },
  {
    id: 'negative-not-sponsored',
    title: 'Explicitly negated sponsor language must not create a segment',
    durationSeconds: 420,
    transcriptCues: [
      cue(90, 'This video is not sponsored by Acme; it is an independent comparison.'),
      cue(98, 'No coupon, promotion, or paid placement was involved.')
    ],
    expectedSegments: [],
    tags: ['negative', 'transcript', 'negation'],
    provenance: SELF_AUTHORED_PROVENANCE
  },
  {
    id: 'negative-ordinary-navigation',
    title: 'Ordinary visit and check-out language must not become an ad read',
    durationSeconds: 540,
    transcriptCues: [
      cue(120, 'Visit the settings page and enable the advanced option.'),
      cue(130, 'Check out the chart to confirm the new value.'),
      cue(140, 'The next section explains why that value changes.')
    ],
    expectedSegments: [],
    tags: ['negative', 'transcript', 'generic-call-to-action'],
    provenance: SELF_AUTHORED_PROVENANCE
  },
  {
    id: 'negative-generic-transcript-links',
    title: 'Ordinary transcript URLs do not impersonate independent frame evidence',
    durationSeconds: 480,
    transcriptCues: [
      cue(70, 'Visit docs.example/guide for the configuration steps.'),
      cue(80, 'Check out source.example/project to inspect the implementation.')
    ],
    expectedSegments: [],
    tags: ['negative', 'transcript', 'visible-link', 'same-channel'],
    provenance: SELF_AUTHORED_PROVENANCE
  },
  {
    id: 'negative-generic-frame-link',
    title: 'An informational on-screen URL remains low-signal',
    durationSeconds: 420,
    transcriptCues: [],
    supportingEvidence: [
      {
        source: 'frame-visible-link',
        kind: 'ad-read-presence',
        startSeconds: 90,
        confidence: 0.24,
        reason: 'Detected URL in video text, but it has no promotional semantics.',
        raw: {
          links: ['https://docs.example/guide'],
          text: 'Documentation: docs.example/guide',
          signal: 'low-signal',
          detector: 'TextDetector'
        }
      }
    ],
    expectedSegments: [],
    tags: ['negative', 'visible-link', 'frame-text', 'low-signal'],
    provenance: SELF_AUTHORED_PROVENANCE
  },
  {
    id: 'negative-return-transition',
    title: 'A casual return phrase without a sponsor start is harmless',
    durationSeconds: 360,
    transcriptCues: [
      cue(44, 'Anyway, let us get back to the earlier question.')
    ],
    expectedSegments: [],
    tags: ['negative', 'transcript', 'end-cue-only'],
    provenance: SELF_AUTHORED_PROVENANCE
  },
  {
    id: 'negative-progress-control',
    title: 'Moving progress geometry without corroboration remains suppressed',
    durationSeconds: 300,
    transcriptCues: [],
    supportingEvidence: [
      progressEvidence(40, 0.2),
      progressEvidence(46, 0.45),
      progressEvidence(52, 0.7)
    ],
    expectedSegments: [],
    tags: ['negative', 'progress-bar', 'uncorroborated'],
    provenance: SELF_AUTHORED_PROVENANCE
  },
  {
    id: 'negative-sponsorship-discussion',
    title: 'A single generic sponsorship mention stays below display confidence',
    durationSeconds: 660,
    transcriptCues: [
      cue(220, 'The report compares sponsorship disclosure rules across formats.')
    ],
    expectedSegments: [],
    tags: ['negative', 'transcript', 'topic-discussion'],
    provenance: SELF_AUTHORED_PROVENANCE
  }
];

function cue(startSeconds: number, text: string, durationSeconds = 4): TranscriptCue {
  return { startSeconds, durationSeconds, text };
}

function progressEvidence(startSeconds: number, fillRatio: number): TimedEvidence {
  return {
    source: 'frame-progress-bar',
    kind: 'ad-read-presence',
    startSeconds,
    confidence: 0.78,
    reason: 'Confirmed a changing horizontal progress bar across consecutive video frames.',
    raw: {
      frameWidth: 960,
      frameHeight: 540,
      trackStartX: 120,
      trackEndX: 840,
      startX: 120,
      endX: 120 + Math.round(720 * fillRatio),
      y: 180,
      rows: 3,
      fillRatio,
      temporalObservations: 2,
      fillDelta: 0.12
    }
  };
}
