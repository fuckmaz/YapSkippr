import { afterEach, beforeEach, vi } from 'vitest';
import { classifyQrPayload, detectQrCue } from '../../src/core/analysis/qr-detector';
import { drawImageData, makeImageData, makeQrImageData } from './detector-fixtures';

beforeEach(() => {
  Reflect.deleteProperty(globalThis, 'BarcodeDetector');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

test('returns no evidence when no QR code is detected', async () => {
  const evidence = await detectQrCue(makeImageData(40, 40, 255), 12);

  expect(evidence).toEqual([]);
});

test('classifies URL-like QR payloads as sponsor CTA evidence', () => {
  expect(classifyQrPayload('https://sponsor.example/offer')).toMatchObject({
    signal: 'sponsor-cta',
    payloadType: 'url'
  });
  expect(classifyQrPayload('sponsor.example/deal')).toMatchObject({
    signal: 'sponsor-cta',
    payloadType: 'url'
  });
});

test('classifies generic HTTP URLs as low-signal QR evidence', () => {
  expect(classifyQrPayload('https://www.wikipedia.org/wiki/QR_code')).toMatchObject({
    signal: 'low-signal',
    payloadType: 'url'
  });
  expect(classifyQrPayload('https://x.co/y')).toMatchObject({
    signal: 'low-signal',
    payloadType: 'url'
  });
});

test('classifies promo-code QR payloads as sponsor CTA evidence', () => {
  expect(classifyQrPayload('USE CODE YAPSKIPPR20')).toMatchObject({
    signal: 'sponsor-cta',
    payloadType: 'promo-code'
  });
});

test('classifies plain-text QR payloads as low-signal evidence', () => {
  expect(classifyQrPayload('hello from the video')).toMatchObject({
    signal: 'low-signal',
    payloadType: 'plain-text'
  });
});

test('returns QR evidence from jsqr fallback results', async () => {
  const evidence = await detectQrCue(makeQrImageData('https://sponsor.example/offer', 4), 12);

  expect(evidence).toHaveLength(1);
  expect(evidence[0]).toMatchObject({
    source: 'frame-qr-code',
    kind: 'ad-read-presence',
    startSeconds: 12,
    raw: {
      value: 'https://sponsor.example/offer',
      detector: 'jsqr',
      location: {
        topLeftCorner: expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) }),
        bottomRightCorner: expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) })
      }
    }
  });
  expect(evidence[0]?.confidence).toBeGreaterThanOrEqual(0.8);
});

test('decodes low-resolution QR codes by retrying with nearest-neighbor upscaling', async () => {
  const evidence = await detectQrCue(makeQrImageData('https://x.co/y', 1), 12);

  expect(evidence).toHaveLength(1);
  expect(evidence[0]?.raw).toMatchObject({
    value: 'https://x.co/y',
    detector: 'jsqr-upscaled'
  });
});

test('decodes small QR overlays embedded inside a larger video frame', async () => {
  const frame = makeImageData(1280, 720, 24);
  drawImageData(frame, makeQrImageData('https://x.co/y', 1), 1190, 48);

  const evidence = await detectQrCue(frame, 24);

  expect(evidence).toHaveLength(1);
  expect(evidence[0]?.raw).toMatchObject({
    value: 'https://x.co/y'
  });
});

test('decodes a small low-contrast QR overlay after regional contrast preprocessing', async () => {
  const frame = makeImageData(1600, 900, 112);
  drawImageData(frame, makeQrImageData('https://x.co/y', 1, 72, 176), 1490, 42);

  const evidence = await detectQrCue(frame, 24);

  expect(evidence).toHaveLength(1);
  expect(evidence[0]?.raw).toMatchObject({
    value: 'https://x.co/y',
    detector: expect.stringMatching(/^jsqr/)
  });
});

test('uses native BarcodeDetector results when available', async () => {
  class BarcodeDetectorMock {
    static async getSupportedFormats(): Promise<string[]> {
      return ['qr_code'];
    }

    async detect(): Promise<Array<{ rawValue: string; format: string }>> {
      return [{ rawValue: 'https://native.example/offer', format: 'qr_code' }];
    }
  }

  vi.stubGlobal('BarcodeDetector', BarcodeDetectorMock);

  const evidence = await detectQrCue(makeImageData(40, 40, 255), 12);

  expect(evidence).toHaveLength(1);
  expect(evidence[0]).toMatchObject({
    source: 'frame-qr-code',
    raw: {
      value: 'https://native.example/offer',
      detector: 'BarcodeDetector',
      signal: 'sponsor-cta',
      payloadType: 'url'
    }
  });
});

test('downgrades native BarcodeDetector plain-text QR payloads', async () => {
  class BarcodeDetectorMock {
    static async getSupportedFormats(): Promise<string[]> {
      return ['qr_code'];
    }

    async detect(): Promise<Array<{ rawValue: string; format: string }>> {
      return [{ rawValue: 'hello from the video', format: 'qr_code' }];
    }
  }

  vi.stubGlobal('BarcodeDetector', BarcodeDetectorMock);

  const evidence = await detectQrCue(makeImageData(40, 40, 255), 12);

  expect(evidence).toHaveLength(1);
  expect(evidence[0]).toMatchObject({
    confidence: 0.32,
    raw: {
      value: 'hello from the video',
      detector: 'BarcodeDetector',
      signal: 'low-signal',
      payloadType: 'plain-text'
    }
  });
});
