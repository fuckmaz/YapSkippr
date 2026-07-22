import { shouldScanQrFrame } from '../../src/core/analysis/qr-scan-cadence';

test('scans the first sampled frame for QR evidence', () => {
  expect(shouldScanQrFrame({
    sampleCount: 1,
    currentTimeSeconds: 5,
    lastQrScanTimeSeconds: null
  })).toBe(true);
});

test('decodes every distinct normal-cadence frame so a QR visible from 3-7s is seen at 5s', () => {
  const qrVisible = (seconds: number) => seconds >= 3 && seconds <= 7;
  const normalSamples = [0, 5, 10];
  const decodedAt = normalSamples.filter((currentTimeSeconds, index) => shouldScanQrFrame({
    sampleCount: index + 1,
    currentTimeSeconds,
    lastQrScanTimeSeconds: index === 0 ? null : normalSamples[index - 1] ?? null
  }) && qrVisible(currentTimeSeconds));

  expect(decodedAt).toEqual([5]);
});

test('Fast Scan improves short-lived QR coverage while keeping one decode per sampled frame', () => {
  const qrVisible = (seconds: number) => seconds >= 3 && seconds <= 7;
  const fastSamples = [0, 2, 4, 6, 8, 10];
  const decodedAt = fastSamples.filter((currentTimeSeconds, index) => shouldScanQrFrame({
    sampleCount: index + 1,
    currentTimeSeconds,
    lastQrScanTimeSeconds: index === 0 ? null : fastSamples[index - 1] ?? null
  }) && qrVisible(currentTimeSeconds));

  expect(decodedAt).toEqual([4, 6]);
});

test('suppresses duplicate callbacks at the same playback position', () => {
  expect(shouldScanQrFrame({
    sampleCount: 2,
    currentTimeSeconds: 5.02,
    lastQrScanTimeSeconds: 5,
  })).toBe(false);

  expect(shouldScanQrFrame({
    sampleCount: 3,
    currentTimeSeconds: 10,
    lastQrScanTimeSeconds: 5,
  })).toBe(true);
});

test('rescans QR after playback seeks backward', () => {
  expect(shouldScanQrFrame({
    sampleCount: 8,
    currentTimeSeconds: 20,
    lastQrScanTimeSeconds: 45
  })).toBe(true);
});

test('rejects invalid frame timestamps without spending QR decode work', () => {
  expect(shouldScanQrFrame({
    sampleCount: 2,
    currentTimeSeconds: Number.NaN,
    lastQrScanTimeSeconds: 5
  })).toBe(false);
});
