import { analyzeTranscriptCues } from '../../src/core/analysis/transcript-analyzer';
import type { TranscriptCue } from '../../src/core/types';

function cue(startSeconds: number, text: string): TranscriptCue {
  return { startSeconds, durationSeconds: 4, text };
}

test('emits strong start evidence for sponsor language', () => {
  const evidence = analyzeTranscriptCues([
    cue(12, "Before we continue, today's sponsor is Acme VPN.")
  ]);

  expect(evidence).toHaveLength(1);
  expect(evidence[0]).toMatchObject({
    source: 'transcript',
    kind: 'ad-read-start',
    startSeconds: 12
  });
  expect(evidence[0]?.confidence).toBeGreaterThanOrEqual(0.75);
});

test('emits weaker presence evidence for call-to-action language', () => {
  const evidence = analyzeTranscriptCues([
    cue(28, 'Use code yapskippr at checkout for a limited time.')
  ]);

  expect(evidence).toHaveLength(1);
  expect(evidence[0]).toMatchObject({
    source: 'transcript',
    kind: 'ad-read-presence',
    startSeconds: 28
  });
  expect(evidence[0]?.confidence).toBeGreaterThanOrEqual(0.35);
  expect(evidence[0]?.confidence).toBeLessThan(0.75);
});

test('emits end evidence for return-to-video phrases', () => {
  const evidence = analyzeTranscriptCues([
    cue(91, "Now back to the video and the thing we're building.")
  ]);

  expect(evidence).toHaveLength(1);
  expect(evidence[0]).toMatchObject({
    source: 'transcript',
    kind: 'ad-read-end',
    startSeconds: 91
  });
});

test('matches phrases case-insensitively', () => {
  const evidence = analyzeTranscriptCues([
    cue(44, 'THANKS TO our sponsor for supporting this episode.')
  ]);

  expect(evidence[0]?.kind).toBe('ad-read-start');
});
