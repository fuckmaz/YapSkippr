import { createPopupScanStatusView } from '../../src/ui/popup-scan-status-view';
import type { ScanStatusSnapshot } from '../../src/core/scan-status';

test('formats a running scan snapshot for the popup', () => {
  const snapshot: ScanStatusSnapshot = {
    platformId: 'youtube',
    videoId: 'abc123',
    pageUrl: 'https://www.youtube.com/watch?v=abc123',
    phase: 'frames',
    message: 'Analyzing frames... 12 sampled',
    progress: 0.5,
    sampleCount: 12,
    candidateCount: 2,
    candidates: ['1:12-2:12 · 86% · transcript + QR'],
    updatedAt: 1_000
  };

  expect(createPopupScanStatusView(snapshot, 6_000)).toEqual({
    title: 'YouTube scan',
    phaseLabel: 'Frames',
    message: 'Analyzing frames... 12 sampled',
    progressPercent: 50,
    progressText: '50%',
    sampleCountText: '12 frames',
    candidateCountText: '2 candidates',
    candidateSummaries: ['1:12-2:12 · 86% · transcript + QR'],
    updatedText: 'Updated 5s ago',
    isRunning: true
  });
});

test('formats idle scan state for the popup', () => {
  const snapshot: ScanStatusSnapshot = {
    platformId: null,
    videoId: null,
    pageUrl: null,
    phase: 'idle',
    message: 'No active scan.',
    progress: 0,
    sampleCount: 0,
    candidateCount: 0,
    candidates: [],
    updatedAt: 10_000
  };

  expect(createPopupScanStatusView(snapshot, 80_000)).toMatchObject({
    title: 'No active scan',
    phaseLabel: 'Idle',
    progressText: '0%',
    sampleCountText: '0 frames',
    candidateCountText: '0 candidates',
    candidateSummaries: [],
    updatedText: 'Updated 1m ago',
    isRunning: false
  });
});
