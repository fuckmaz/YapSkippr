import jsQR from 'jsqr';
import { beforeEach, vi } from 'vitest';
import { detectQrCue } from '../../src/core/analysis/qr-detector';

vi.mock('jsqr', () => ({
  default: vi.fn()
}));

function makeImageData(width: number, height: number): ImageData {
  return {
    data: new Uint8ClampedArray(width * height * 4),
    width,
    height,
    colorSpace: 'srgb'
  } as ImageData;
}

const mockedJsQr = vi.mocked(jsQR);

beforeEach(() => {
  Reflect.deleteProperty(globalThis, 'BarcodeDetector');
  mockedJsQr.mockReset();
});

test('returns no evidence when no QR code is detected', async () => {
  mockedJsQr.mockReturnValue(null);

  const evidence = await detectQrCue(makeImageData(10, 10), 12);

  expect(evidence).toEqual([]);
});

test('returns QR evidence from jsqr fallback results', async () => {
  mockedJsQr.mockReturnValue({
    binaryData: [],
    data: 'https://sponsor.example/offer',
    chunks: [],
    version: 1,
    location: {
      topRightCorner: { x: 9, y: 1 },
      topLeftCorner: { x: 1, y: 1 },
      bottomRightCorner: { x: 9, y: 9 },
      bottomLeftCorner: { x: 1, y: 9 },
      topRightFinderPattern: { x: 9, y: 1 },
      topLeftFinderPattern: { x: 1, y: 1 },
      bottomLeftFinderPattern: { x: 1, y: 9 },
      bottomRightAlignmentPattern: { x: 9, y: 9 }
    }
  });

  const evidence = await detectQrCue(makeImageData(10, 10), 12);

  expect(evidence).toHaveLength(1);
  expect(evidence[0]).toMatchObject({
    source: 'frame-qr-code',
    kind: 'ad-read-presence',
    startSeconds: 12,
    raw: { value: 'https://sponsor.example/offer', detector: 'jsqr' }
  });
  expect(evidence[0]?.confidence).toBeGreaterThanOrEqual(0.8);
});
