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

test('emits strong start evidence for made-possible-by sponsor language', () => {
  const evidence = analyzeTranscriptCues([
    cue(18, 'This episode is made possible by Acme VPN.')
  ]);

  expect(evidence).toHaveLength(1);
  expect(evidence[0]).toMatchObject({
    source: 'transcript',
    kind: 'ad-read-start',
    startSeconds: 18
  });
  expect(evidence[0]?.reason).toContain('made possible by');
});

test('matches sponsor phrases split across adjacent caption cues', () => {
  const evidence = analyzeTranscriptCues([
    cue(18, 'This episode is made possible'),
    cue(20, 'by Acme VPN.')
  ]);

  expect(evidence).toHaveLength(1);
  expect(evidence[0]).toMatchObject({
    source: 'transcript',
    kind: 'ad-read-start',
    startSeconds: 18
  });
});

test('does not pull a sponsor cue backward into the preceding caption', () => {
  const evidence = analyzeTranscriptCues([
    cue(14, 'First, let us finish the setup.'),
    cue(18, 'This episode is made possible by Acme VPN.')
  ]);

  expect(evidence).toHaveLength(1);
  expect(evidence[0]?.startSeconds).toBe(18);
});

test('keeps a current-cue sponsor match when a higher-priority phrase starts in the next cue', () => {
  const evidence = analyzeTranscriptCues([
    cue(12, 'This episode is brought to you by Acme.'),
    cue(16, "Today's sponsor is Beta.")
  ]);

  expect(evidence.map((item) => item.startSeconds)).toEqual([12, 16]);
  expect(evidence[0]?.reason).toContain('brought to you by');
  expect(evidence[1]?.reason).toContain("today's sponsor");
});

test('accepts code-configured transcript phrase groups', () => {
  const evidence = analyzeTranscriptCues(
    [cue(64, 'Creator break starts here before the main topic continues.')],
    {
      phraseGroups: [
        {
          id: 'custom-start',
          kind: 'ad-read-start',
          confidence: 0.8,
          reasonLabel: 'custom transcript cue',
          phrases: ['creator break starts here']
        }
      ]
    }
  );

  expect(evidence).toHaveLength(1);
  expect(evidence[0]).toMatchObject({
    source: 'transcript',
    kind: 'ad-read-start',
    startSeconds: 64,
    confidence: 0.8
  });
  expect(evidence[0]?.reason).toContain('creator break starts here');
});

test('uses supplied phrase groups instead of defaults so phrases can be removed', () => {
  const evidence = analyzeTranscriptCues(
    [cue(12, "Before we continue, today's sponsor is Acme VPN.")],
    { phraseGroups: [] }
  );

  expect(evidence).toEqual([]);
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

test('does not treat explicitly negated sponsor language as an ad-read start', () => {
  expect(analyzeTranscriptCues([
    cue(44, 'This video is not sponsored by Acme; it is an independent comparison.'),
    cue(48, "The follow-up isn't sponsored by anyone either.")
  ])).toEqual([]);
});

test('keeps affirmative not-only sponsor disclosures', () => {
  const evidence = analyzeTranscriptCues([
    cue(44, 'This project is not only sponsored by Acme, but also built with its public API.')
  ]);

  expect(evidence[0]).toMatchObject({
    kind: 'ad-read-start',
    startSeconds: 44
  });
});
