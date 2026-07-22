import { createAutoSkipController } from '../../src/core/auto-skip-controller';
import { buildSegmentCandidates } from '../../src/core/analysis/evidence-fusion';
import type { SegmentCandidate, TimedEvidence } from '../../src/core/types';

function evidence(kind: TimedEvidence['kind'], startSeconds: number): TimedEvidence {
  return {
    source: 'transcript',
    kind,
    startSeconds,
    confidence: 0.9,
    reason: 'test cue'
  };
}

function candidate(overrides: Partial<SegmentCandidate> = {}): SegmentCandidate {
  return {
    startSeconds: 30,
    endSeconds: 90,
    confidence: 0.86,
    evidence: [evidence('ad-read-start', 30), evidence('ad-read-end', 90)],
    ...overrides
  };
}

const playingAt = (currentTimeSeconds: number, durationSeconds: number | null = 600) => ({
  currentTimeSeconds,
  durationSeconds,
  isPlaying: true
});

test('is disabled by default and never moves playback while off', () => {
  const controller = createAutoSkipController();
  controller.updateCandidates([candidate()]);

  expect(controller.isEnabled()).toBe(false);
  expect(controller.evaluate(playingAt(35))).toBeNull();
});

test('skips a high-confidence bounded candidate with a detected ending', () => {
  const controller = createAutoSkipController({ enabled: true });
  controller.updateCandidates([candidate()]);

  expect(controller.evaluate(playingAt(35))).toEqual({
    id: '30.0-90.0',
    candidateStartSeconds: 30,
    candidateEndSeconds: 90,
    confidence: 0.86,
    fromSeconds: 35,
    toSeconds: 90.15,
    skippedSeconds: 55.150000000000006
  });
});

test('rejects open, inferred-boundary, low-confidence, and unsafe-duration candidates', () => {
  const controller = createAutoSkipController({ enabled: true });
  controller.updateCandidates([
    candidate({ endSeconds: undefined }),
    candidate({ evidence: [evidence('ad-read-start', 30)] }),
    candidate({ confidence: 0.71 }),
    candidate({ confidence: Number.NaN }),
    candidate({ endSeconds: 32, evidence: [evidence('ad-read-end', 32)] }),
    candidate({ endSeconds: 280, evidence: [evidence('ad-read-end', 280)] })
  ]);

  expect(controller.evaluate(playingAt(31))).toBeNull();
});

test('does not skip when playback is paused or outside the candidate', () => {
  const controller = createAutoSkipController({ enabled: true });
  controller.updateCandidates([candidate()]);

  expect(controller.evaluate({ ...playingAt(35), isPlaying: false })).toBeNull();
  expect(controller.evaluate(playingAt(20))).toBeNull();
  expect(controller.evaluate(playingAt(90))).toBeNull();
});

test('does not seek for negligible remaining time', () => {
  const controller = createAutoSkipController({ enabled: true });
  controller.updateCandidates([candidate()]);

  expect(controller.evaluate(playingAt(89))).toBeNull();
});

test('clamps the skip target to finite video duration', () => {
  const controller = createAutoSkipController({ enabled: true });
  controller.updateCandidates([candidate({ endSeconds: 99.9, evidence: [evidence('ad-read-end', 99.9)] })]);

  expect(controller.evaluate(playingAt(80, 100))?.toSeconds).toBe(100);
});

test('handles each segment only once even after a manual seek backward', () => {
  const controller = createAutoSkipController({ enabled: true });
  controller.updateCandidates([candidate()]);

  expect(controller.evaluate(playingAt(35))).not.toBeNull();
  expect(controller.evaluate(playingAt(40))).toBeNull();
});

test('suppresses overlapping boundary refinements after a skip', () => {
  const controller = createAutoSkipController({ enabled: true });
  controller.updateCandidates([candidate()]);
  expect(controller.evaluate(playingAt(35))).not.toBeNull();

  controller.updateCandidates([candidate({ startSeconds: 28, endSeconds: 94, evidence: [evidence('ad-read-end', 94)] })]);
  expect(controller.evaluate(playingAt(91))).toBeNull();
});

test('allows a distinct segment that begins exactly where the prior segment ended', () => {
  const controller = createAutoSkipController({ enabled: true });
  controller.updateCandidates([candidate()]);
  expect(controller.evaluate(playingAt(35))).not.toBeNull();

  controller.updateCandidates([candidate({
    startSeconds: 90,
    endSeconds: 120,
    evidence: [evidence('ad-read-start', 90), evidence('ad-read-end', 120)]
  })]);
  expect(controller.evaluate(playingAt(95))).toMatchObject({
    candidateStartSeconds: 90,
    candidateEndSeconds: 120
  });
});

test('undo returns to the exact pre-skip position without rearming the segment', () => {
  const controller = createAutoSkipController({ enabled: true });
  controller.updateCandidates([candidate()]);
  const decision = controller.evaluate(playingAt(35.4));

  expect(controller.undoLast()).toEqual({ decision, targetSeconds: 35.4 });
  expect(controller.undoLast()).toBeNull();
  expect(controller.evaluate(playingAt(35.4))).toBeNull();
});

test('disabling clears pending undo while preserving handled ranges', () => {
  const controller = createAutoSkipController({ enabled: true });
  controller.updateCandidates([candidate()]);
  expect(controller.evaluate(playingAt(35))).not.toBeNull();

  controller.setEnabled(false);
  controller.setEnabled(true);
  expect(controller.undoLast()).toBeNull();
  expect(controller.evaluate(playingAt(40))).toBeNull();
});

test('resetSession clears candidates, undo, and handled ranges but keeps the preference', () => {
  const controller = createAutoSkipController({ enabled: true });
  controller.updateCandidates([candidate()]);
  expect(controller.evaluate(playingAt(35))).not.toBeNull();
  controller.resetSession();

  expect(controller.isEnabled()).toBe(true);
  expect(controller.undoLast()).toBeNull();
  expect(controller.evaluate(playingAt(35))).toBeNull();

  controller.updateCandidates([candidate()]);
  expect(controller.evaluate(playingAt(35))).not.toBeNull();
});

test('accepts a strong candidate produced by real evidence fusion with a detected end cue', () => {
  const fused = buildSegmentCandidates([
    { ...evidence('ad-read-start', 30), confidence: 0.9 },
    { ...evidence('ad-read-end', 90), confidence: 0.8 }
  ]);
  const controller = createAutoSkipController({ enabled: true });
  controller.updateCandidates(fused);

  expect(fused).toHaveLength(1);
  expect(fused[0]?.confidence).toBeGreaterThanOrEqual(0.72);
  expect(controller.evaluate(playingAt(35))).toMatchObject({
    candidateStartSeconds: 30,
    candidateEndSeconds: 90,
    fromSeconds: 35
  });
});

test('rejects a high-confidence fusion candidate whose end is only inferred', () => {
  const fused = buildSegmentCandidates([
    { ...evidence('ad-read-start', 30), confidence: 0.95 },
    {
      source: 'frame-qr-code',
      kind: 'ad-read-presence',
      startSeconds: 35,
      confidence: 0.95,
      reason: 'strong sponsor QR',
      raw: { value: 'https://sponsor.example/offer', signal: 'sponsor-cta' }
    }
  ]);
  const controller = createAutoSkipController({ enabled: true });
  controller.updateCandidates(fused);

  expect(fused).toHaveLength(1);
  expect(fused[0]?.endSeconds).toBeDefined();
  expect(controller.evaluate(playingAt(35))).toBeNull();
});
