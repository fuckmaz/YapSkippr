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
    videoCurrentTimeSeconds: 93,
    videoDurationSeconds: 612,
    fastScanEnabled: true,
    fastScanIntervalSeconds: 2,
    candidateCount: 2,
    evidenceCounts: {
      transcript: 3,
      progressBar: 2,
      qrCode: 1,
      visibleLink: 1,
      total: 7
    },
    candidates: [
      {
        id: 'candidate-72',
        startSeconds: 72,
        endSeconds: 132,
        confidence: 0.86,
        summary: '1:12-2:12 · 86% · transcript + QR',
        sources: ['transcript', 'QR']
      }
    ],
    recentEvidence: [
      {
        id: 'evidence-1',
        source: 'frame-visible-link',
        kind: 'ad-read-presence',
        startSeconds: 95,
        confidence: 0.72,
        reason: 'Detected visible HTTP link in sampled video frame.',
        detail: 'https://brand.example/deal'
      }
    ],
    recentEvents: [
      {
        id: 'event-1',
        level: 'info',
        message: 'Transcript evidence found',
        timestamp: 1_000,
        detail: '3 cues matched'
      }
    ],
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
    videoTimeText: '1:33 / 10:12',
    evidenceItems: [
      { label: 'Transcript', value: '3' },
      { label: 'Progress', value: '2' },
      { label: 'QR', value: '1' },
      { label: 'Links', value: '1' }
    ],
    fastScanText: 'Fast pre-scan on · 2s interval',
    candidates: [
      {
        id: 'candidate-72',
        summary: '1:12-2:12 · 86% · transcript + QR',
        detail: '86% confidence · transcript + QR',
        seekSeconds: 72,
        actionLabel: 'Jump to 1:12'
      }
    ],
    events: [
      {
        id: 'event-1',
        level: 'info',
        message: 'Transcript evidence found',
        detail: '3 cues matched',
        ageText: '5s ago'
      }
    ],
    evidenceEvents: [
      {
        id: 'evidence-1',
        sourceLabel: 'Visible link',
        kindLabel: 'Presence',
        timeLabel: '1:35',
        startSeconds: 95,
        confidenceText: '72%',
        reason: 'Detected visible HTTP link in sampled video frame.',
        detail: 'https://brand.example/deal'
      }
    ],
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
    videoCurrentTimeSeconds: null,
    videoDurationSeconds: null,
    fastScanEnabled: false,
    fastScanIntervalSeconds: 2,
    candidateCount: 0,
    evidenceCounts: {
      transcript: 0,
      progressBar: 0,
      qrCode: 0,
      visibleLink: 0,
      total: 0
    },
    candidates: [],
    recentEvidence: [],
    recentEvents: [],
    updatedAt: 10_000
  };

  expect(createPopupScanStatusView(snapshot, 80_000)).toMatchObject({
    title: 'No active scan',
    phaseLabel: 'Idle',
    progressText: '0%',
    sampleCountText: '0 frames',
    candidateCountText: '0 candidates',
    videoTimeText: 'No video timing',
    fastScanText: 'Fast pre-scan off',
    candidates: [],
    events: [],
    evidenceEvents: [],
    updatedText: 'Updated 1m ago',
    isRunning: false
  });
});

test('labels stale running scan state in the popup', () => {
  const snapshot: ScanStatusSnapshot = {
    platformId: 'youtube',
    videoId: 'abc123',
    pageUrl: 'https://www.youtube.com/watch?v=abc123',
    phase: 'frames',
    message: 'Analyzing frames...',
    progress: 0.4,
    sampleCount: 4,
    videoCurrentTimeSeconds: 40,
    videoDurationSeconds: 200,
    fastScanEnabled: false,
    fastScanIntervalSeconds: 2,
    candidateCount: 0,
    evidenceCounts: {
      transcript: 0,
      progressBar: 0,
      qrCode: 0,
      visibleLink: 0,
      total: 0
    },
    candidates: [],
    recentEvidence: [],
    recentEvents: [],
    updatedAt: 1_000
  };

  expect(createPopupScanStatusView(snapshot, 30_000)).toMatchObject({
    title: 'YouTube scan',
    phaseLabel: 'Stale',
    updatedText: 'Updated 29s ago',
    isRunning: false
  });
});
