import { calculateFrameScanProgress } from '../../src/core/analysis/scan-progress';

test('returns 100 percent when playback reaches the end of a finite video', () => {
  expect(
    calculateFrameScanProgress({
      currentTimeSeconds: 600,
      durationSeconds: 600,
      sampleCount: 24
    })
  ).toBe(1);
});

test('uses playback progress to move beyond the old sampling cap near the end of the video', () => {
  expect(
    calculateFrameScanProgress({
      currentTimeSeconds: 590,
      durationSeconds: 600,
      sampleCount: 24
    })
  ).toBeGreaterThan(0.95);
});
