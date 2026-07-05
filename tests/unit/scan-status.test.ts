import {
  createIdleScanStatus,
  mergeScanStatus,
  normalizeScanStatus
} from '../../src/core/scan-status';

test('merges scan status patches for popup subscribers', () => {
  const idle = createIdleScanStatus(100);
  const status = mergeScanStatus(
    idle,
    {
      platformId: 'youtube',
      videoId: 'abc123',
      pageUrl: 'https://www.youtube.com/watch?v=abc123',
      phase: 'frames',
      message: 'Analyzing frames... 12 sampled',
      progress: 1.2,
      sampleCount: 12,
      candidateCount: 2,
      candidates: ['1:12-2:12 · 86% · transcript + QR']
    },
    200
  );

  expect(status).toEqual({
    platformId: 'youtube',
    videoId: 'abc123',
    pageUrl: 'https://www.youtube.com/watch?v=abc123',
    phase: 'frames',
    message: 'Analyzing frames... 12 sampled',
    progress: 1,
    sampleCount: 12,
    candidateCount: 2,
    candidates: ['1:12-2:12 · 86% · transcript + QR'],
    updatedAt: 200
  });
});

test('normalizes missing or malformed scan status to idle', () => {
  expect(normalizeScanStatus(undefined, 500)).toEqual(createIdleScanStatus(500));
  expect(normalizeScanStatus({ phase: 'wat', progress: -1 }, 600)).toEqual(createIdleScanStatus(600));
});
