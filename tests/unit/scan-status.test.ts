import {
  appendScanStatusEvent,
  appendScanStatusEvidence,
  createIdleScanStatus,
  isScanStatusStale,
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
      videoCurrentTimeSeconds: 93.4,
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
      recentEvents: [
        {
          id: 'event-1',
          level: 'info',
          message: 'Transcript evidence found',
          timestamp: 150
        }
      ]
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
    videoCurrentTimeSeconds: 93.4,
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
    recentEvidence: [],
    recentEvents: [
      {
        id: 'event-1',
        level: 'info',
        message: 'Transcript evidence found',
        timestamp: 150
      }
    ],
    updatedAt: 200
  });
});

test('normalizes missing or malformed scan status to idle', () => {
  expect(normalizeScanStatus(undefined, 500)).toEqual(createIdleScanStatus(500));
  expect(normalizeScanStatus({ phase: 'wat', progress: -1 }, 600)).toEqual(createIdleScanStatus(600));
});

test('appends recent events newest first and limits the timeline', () => {
  let status = createIdleScanStatus(100);

  for (let index = 0; index < 18; index += 1) {
    status = appendScanStatusEvent(status, {
      level: index % 2 === 0 ? 'info' : 'warn',
      message: `Event ${index}`,
      timestamp: 1_000 + index
    });
  }

  expect(status.recentEvents).toHaveLength(16);
  expect(status.recentEvents[0]?.message).toBe('Event 17');
  expect(status.recentEvents.at(-1)?.message).toBe('Event 2');
});

test('appends detailed evidence entries and source-specific timeline events', () => {
  const status = appendScanStatusEvidence(
    createIdleScanStatus(100),
    [
      {
        source: 'frame-visible-link',
        kind: 'ad-read-presence',
        startSeconds: 42,
        confidence: 0.72,
        reason: 'Detected visible HTTP link in sampled video frame.',
        raw: {
          links: ['https://brand.example/deal'],
          text: 'Visit https://brand.example/deal'
        }
      }
    ],
    200
  );

  expect(status.recentEvidence).toEqual([
    {
      id: '200-0-frame-visible-link-42',
      source: 'frame-visible-link',
      kind: 'ad-read-presence',
      startSeconds: 42,
      confidence: 0.72,
      reason: 'Detected visible HTTP link in sampled video frame.',
      detail: 'https://brand.example/deal'
    }
  ]);
  expect(status.recentEvents[0]).toMatchObject({
    level: 'info',
    message: 'Visible link evidence at 0:42',
    detail: 'Detected visible HTTP link in sampled video frame.'
  });
});

test('marks running scan status stale after the threshold', () => {
  const status = mergeScanStatus(createIdleScanStatus(0), {
    phase: 'frames',
    message: 'Analyzing frames...',
    progress: 0.4
  }, 1_000);

  expect(isScanStatusStale(status, 10_000, 15_000)).toBe(false);
  expect(isScanStatusStale(status, 17_001, 15_000)).toBe(true);
  expect(isScanStatusStale({ ...status, phase: 'stopped' }, 60_000, 15_000)).toBe(false);
});
