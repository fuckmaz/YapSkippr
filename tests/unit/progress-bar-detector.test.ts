import {
  createProgressBarTracker,
  detectProgressBarCue
} from '../../src/core/analysis/progress-bar-detector';
import { drawHorizontalLine, drawProgressBar, makeImageData } from './detector-fixtures';

test('detects a long bright horizontal progress bar away from YouTube controls', () => {
  const imageData = makeImageData(100, 80);
  drawProgressBar(imageData, 29, 10, 69, 89);
  drawProgressBar(imageData, 30, 10, 69, 89);
  drawProgressBar(imageData, 31, 10, 69, 89);

  const evidence = detectProgressBarCue(imageData, 42);

  expect(evidence).toHaveLength(1);
  expect(evidence[0]).toMatchObject({
    source: 'frame-progress-bar',
    kind: 'ad-read-presence',
    startSeconds: 42
  });
  expect(evidence[0]?.confidence).toBeGreaterThan(0.45);
});

test('ignores short horizontal lines', () => {
  const imageData = makeImageData(100, 80);
  drawHorizontalLine(imageData, 30, 10, 18);

  const evidence = detectProgressBarCue(imageData, 42);

  expect(evidence).toEqual([]);
});

test('ignores likely YouTube control bar near the bottom', () => {
  const imageData = makeImageData(100, 100);
  drawProgressBar(imageData, 84, 5, 70, 95);
  drawProgressBar(imageData, 85, 5, 70, 95);
  drawProgressBar(imageData, 86, 5, 70, 95);

  const evidence = detectProgressBarCue(imageData, 42);

  expect(evidence).toEqual([]);
});

test('ignores single-pixel horizontal separators', () => {
  const imageData = makeImageData(100, 80);
  drawHorizontalLine(imageData, 30, 10, 89);

  const evidence = detectProgressBarCue(imageData, 42);

  expect(evidence).toEqual([]);
});

test('ignores thick decorative lines without a dim progress track', () => {
  const imageData = makeImageData(100, 80);
  drawHorizontalLine(imageData, 29, 10, 89);
  drawHorizontalLine(imageData, 30, 10, 89);
  drawHorizontalLine(imageData, 31, 10, 89);

  const evidence = detectProgressBarCue(imageData, 42);

  expect(evidence).toEqual([]);
});

test('raises confidence when matching horizontal bars persist across neighboring rows', () => {
  const twoRows = makeImageData(100, 80);
  drawProgressBar(twoRows, 30, 10, 69, 89);
  drawProgressBar(twoRows, 31, 10, 69, 89);

  const fourRows = makeImageData(100, 80);
  drawProgressBar(fourRows, 29, 10, 69, 89);
  drawProgressBar(fourRows, 30, 10, 69, 89);
  drawProgressBar(fourRows, 31, 10, 69, 89);
  drawProgressBar(fourRows, 32, 10, 69, 89);

  const twoRowEvidence = detectProgressBarCue(twoRows, 42);
  const fourRowEvidence = detectProgressBarCue(fourRows, 42);

  expect(fourRowEvidence[0]?.confidence).toBeGreaterThan(twoRowEvidence[0]?.confidence ?? 0);
});

test('does not confirm static progress-like decoration across video frames', () => {
  const tracker = createProgressBarTracker();
  const imageData = makeImageData(200, 120);
  for (let y = 44; y <= 47; y += 1) drawProgressBar(imageData, y, 20, 125, 180);

  const samples = [10, 15, 20].map((time) => detectProgressBarCue(imageData, time));
  for (const sample of samples) expect(sample).toHaveLength(1);

  expect(tracker.observe(samples[0]!)).toEqual([]);
  expect(tracker.observe(samples[1]!)).toEqual([]);
  expect(tracker.observe(samples[2]!)).toEqual([]);
});

test('confirms a stable track only after its fill changes over time', () => {
  const tracker = createProgressBarTracker();
  const first = makeImageData(200, 120);
  const second = makeImageData(200, 120);
  for (let y = 44; y <= 47; y += 1) {
    drawProgressBar(first, y, 20, 90, 180);
    drawProgressBar(second, y, 20, 118, 180);
  }

  expect(tracker.observe(detectProgressBarCue(first, 10))).toEqual([]);
  const confirmed = tracker.observe(detectProgressBarCue(second, 15));

  expect(confirmed).toHaveLength(1);
  expect(confirmed[0]).toMatchObject({
    source: 'frame-progress-bar',
    startSeconds: 10,
    raw: {
      confirmedAtSeconds: 15,
      temporalObservations: 2,
      fillDelta: expect.any(Number)
    }
  });
  expect(confirmed[0]?.confidence).toBeGreaterThanOrEqual(0.78);
  expect(confirmed[0]?.reason).toContain('changing horizontal progress bar');
});

test('confirms cumulative movement when each individual fill change is sub-threshold', () => {
  const tracker = createProgressBarTracker();
  const first = makeImageData(200, 120);
  const second = makeImageData(200, 120);
  const third = makeImageData(200, 120);
  for (let y = 44; y <= 47; y += 1) {
    drawProgressBar(first, y, 20, 90, 180);
    drawProgressBar(second, y, 20, 93, 180);
    drawProgressBar(third, y, 20, 96, 180);
  }

  expect(tracker.observe(detectProgressBarCue(first, 10))).toEqual([]);
  expect(tracker.observe(detectProgressBarCue(second, 15))).toEqual([]);

  const confirmed = tracker.observe(detectProgressBarCue(third, 20));
  expect(confirmed).toHaveLength(1);
  expect(confirmed[0]).toMatchObject({
    startSeconds: 10,
    raw: {
      confirmedAtSeconds: 20,
      temporalObservations: 3
    }
  });
});

test('confirms countdown bars whose fill decreases over time', () => {
  const tracker = createProgressBarTracker();
  const first = makeImageData(200, 120);
  const second = makeImageData(200, 120);
  for (let y = 44; y <= 47; y += 1) {
    drawProgressBar(first, y, 20, 140, 180);
    drawProgressBar(second, y, 20, 118, 180);
  }

  expect(tracker.observe(detectProgressBarCue(first, 10))).toEqual([]);
  const confirmed = tracker.observe(detectProgressBarCue(second, 15));

  expect(confirmed).toHaveLength(1);
  expect(confirmed[0]?.raw).toMatchObject({
    fillDelta: expect.any(Number)
  });
  expect((confirmed[0]?.raw as { fillDelta: number }).fillDelta).toBeLessThan(0);
});

test('restarts from an implausibly large fill jump before later confirmation', () => {
  const tracker = createProgressBarTracker();
  const first = makeImageData(200, 120);
  const jump = makeImageData(200, 120);
  const next = makeImageData(200, 120);
  for (let y = 44; y <= 47; y += 1) {
    drawProgressBar(first, y, 20, 60, 180);
    drawProgressBar(jump, y, 20, 178, 180);
    drawProgressBar(next, y, 20, 173, 180);
  }
  const options = { minWidthRatio: 0.1, minTrackExtensionRatio: 0.005 };

  expect(tracker.observe(detectProgressBarCue(first, 10, options))).toEqual([]);
  expect(tracker.observe(detectProgressBarCue(jump, 15, options))).toEqual([]);

  const confirmed = tracker.observe(detectProgressBarCue(next, 20, options));
  expect(confirmed).toHaveLength(1);
  expect(confirmed[0]).toMatchObject({
    startSeconds: 15,
    raw: {
      confirmedAtSeconds: 20,
      temporalObservations: 2
    }
  });
});

test('matches the same progress track across proportional frame-size changes', () => {
  const tracker = createProgressBarTracker();
  const first = makeImageData(200, 120);
  const second = makeImageData(400, 240);
  for (let y = 44; y <= 47; y += 1) drawProgressBar(first, y, 20, 90, 180);
  for (let y = 88; y <= 95; y += 1) drawProgressBar(second, y, 40, 236, 360);

  expect(tracker.observe(detectProgressBarCue(first, 10))).toEqual([]);
  const confirmed = tracker.observe(detectProgressBarCue(second, 15));

  expect(confirmed).toHaveLength(1);
  expect(confirmed[0]).toMatchObject({
    startSeconds: 10,
    raw: {
      confirmedAtSeconds: 15,
      temporalObservations: 2
    }
  });
});

test('malformed progress geometry resets the tracking chain', () => {
  const first = makeImageData(200, 120);
  const second = makeImageData(200, 120);
  const third = makeImageData(200, 120);
  for (let y = 44; y <= 47; y += 1) {
    drawProgressBar(first, y, 20, 90, 180);
    drawProgressBar(second, y, 20, 118, 180);
    drawProgressBar(third, y, 20, 140, 180);
  }
  const firstEvidence = detectProgressBarCue(first, 10);
  const secondEvidence = detectProgressBarCue(second, 20);
  const thirdEvidence = detectProgressBarCue(third, 25);
  expect(firstEvidence).toHaveLength(1);
  expect(secondEvidence).toHaveLength(1);
  expect(thirdEvidence).toHaveLength(1);

  const validRaw = secondEvidence[0]!.raw as Record<string, unknown>;
  const malformedCases: Array<Record<string, unknown>> = [
    { frameWidth: 0 },
    { y: 120 },
    { trackStartX: 181 },
    { startX: 10 },
    { fillRatio: 1.1 }
  ];

  for (const malformedFields of malformedCases) {
    const tracker = createProgressBarTracker();
    const malformedEvidence = [{
      ...secondEvidence[0]!,
      startSeconds: 15,
      raw: { ...validRaw, ...malformedFields }
    }];

    expect(tracker.observe(firstEvidence)).toEqual([]);
    expect(tracker.observe(malformedEvidence)).toEqual([]);
    expect(tracker.observe(secondEvidence)).toEqual([]);
    expect(tracker.observe(thirdEvidence)).toHaveLength(1);
  }
});

test('an in-range fill ratio inconsistent with its coordinates resets the tracking chain', () => {
  const tracker = createProgressBarTracker();
  const first = makeImageData(200, 120);
  const second = makeImageData(200, 120);
  const third = makeImageData(200, 120);
  for (let y = 44; y <= 47; y += 1) {
    drawProgressBar(first, y, 20, 90, 180);
    drawProgressBar(second, y, 20, 118, 180);
    drawProgressBar(third, y, 20, 140, 180);
  }
  const firstEvidence = detectProgressBarCue(first, 10);
  const secondEvidence = detectProgressBarCue(second, 20);
  const thirdEvidence = detectProgressBarCue(third, 25);
  expect(firstEvidence).toHaveLength(1);
  expect(secondEvidence).toHaveLength(1);
  expect(thirdEvidence).toHaveLength(1);

  const validRaw = secondEvidence[0]!.raw as Record<string, unknown>;
  const inconsistentEvidence = [{
    ...secondEvidence[0]!,
    startSeconds: 15,
    raw: { ...validRaw, fillRatio: 0.5 }
  }];

  expect(tracker.observe(firstEvidence)).toEqual([]);
  expect(tracker.observe(inconsistentEvidence)).toEqual([]);
  expect(tracker.observe(secondEvidence)).toEqual([]);
  const confirmed = tracker.observe(thirdEvidence);
  expect(confirmed).toHaveLength(1);
  expect(confirmed[0]?.startSeconds).toBe(20);
});

test('reset explicitly clears progress tracking state', () => {
  const tracker = createProgressBarTracker();
  const first = makeImageData(200, 120);
  const second = makeImageData(200, 120);
  const third = makeImageData(200, 120);
  for (let y = 44; y <= 47; y += 1) {
    drawProgressBar(first, y, 20, 90, 180);
    drawProgressBar(second, y, 20, 118, 180);
    drawProgressBar(third, y, 20, 140, 180);
  }

  expect(tracker.observe(detectProgressBarCue(first, 10))).toEqual([]);
  tracker.reset();
  expect(tracker.observe(detectProgressBarCue(second, 15))).toEqual([]);

  const confirmed = tracker.observe(detectProgressBarCue(third, 20));
  expect(confirmed).toHaveLength(1);
  expect(confirmed[0]?.startSeconds).toBe(15);
});

test('requires an unbroken chain of progress-bar observations', () => {
  const tracker = createProgressBarTracker();
  const first = makeImageData(200, 120);
  const second = makeImageData(200, 120);
  const third = makeImageData(200, 120);
  for (let y = 44; y <= 47; y += 1) {
    drawProgressBar(first, y, 20, 90, 180);
    drawProgressBar(second, y, 20, 118, 180);
    drawProgressBar(third, y, 20, 140, 180);
  }

  expect(tracker.observe(detectProgressBarCue(first, 10))).toEqual([]);
  expect(tracker.observe([])).toEqual([]);
  expect(tracker.observe(detectProgressBarCue(second, 15))).toEqual([]);

  const confirmed = tracker.observe(detectProgressBarCue(third, 20));
  expect(confirmed).toHaveLength(1);
  expect(confirmed[0]).toMatchObject({
    startSeconds: 15,
    raw: {
      confirmedAtSeconds: 20,
      temporalObservations: 2
    }
  });
});

test('restarts tracking after a backward seek before confirming later forward motion', () => {
  const tracker = createProgressBarTracker();
  const beforeSeek = makeImageData(200, 120);
  const afterSeek = makeImageData(200, 120);
  const forward = makeImageData(200, 120);
  for (let y = 44; y <= 47; y += 1) {
    drawProgressBar(beforeSeek, y, 20, 90, 180);
    drawProgressBar(afterSeek, y, 20, 118, 180);
    drawProgressBar(forward, y, 20, 140, 180);
  }

  expect(tracker.observe(detectProgressBarCue(beforeSeek, 30))).toEqual([]);
  expect(tracker.observe(detectProgressBarCue(afterSeek, 25))).toEqual([]);

  const confirmed = tracker.observe(detectProgressBarCue(forward, 30));
  expect(confirmed).toHaveLength(1);
  expect(confirmed[0]).toMatchObject({
    startSeconds: 25,
    raw: {
      confirmedAtSeconds: 30,
      temporalObservations: 2
    }
  });
});

test('restarts tracking when progress-bar observations are more than 20 seconds apart', () => {
  const tracker = createProgressBarTracker();
  const first = makeImageData(200, 120);
  const afterGap = makeImageData(200, 120);
  const next = makeImageData(200, 120);
  for (let y = 44; y <= 47; y += 1) {
    drawProgressBar(first, y, 20, 90, 180);
    drawProgressBar(afterGap, y, 20, 118, 180);
    drawProgressBar(next, y, 20, 140, 180);
  }

  expect(tracker.observe(detectProgressBarCue(first, 10))).toEqual([]);
  expect(tracker.observe(detectProgressBarCue(afterGap, 31))).toEqual([]);

  const confirmed = tracker.observe(detectProgressBarCue(next, 35));
  expect(confirmed).toHaveLength(1);
  expect(confirmed[0]).toMatchObject({
    startSeconds: 31,
    raw: {
      confirmedAtSeconds: 35,
      temporalObservations: 2
    }
  });
});
