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
