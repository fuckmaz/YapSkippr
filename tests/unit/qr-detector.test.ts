import { afterEach, beforeEach, vi } from 'vitest';
import { detectQrCue } from '../../src/core/analysis/qr-detector';

const QR_FIXTURES: Record<string, string[]> = {
  'https://sponsor.example/offer': [
    '11111110100011001111101111111',
    '10000010001011111000001000001',
    '10111010100011111101101011101',
    '10111010110001101111001011101',
    '10111010100001001011001011101',
    '10000010100100000111101000001',
    '11111110101010101010101111111',
    '00000000000001110001000000000',
    '00111111001011101010010111101',
    '01111000101110110001001111100',
    '00000110001000001010100100010',
    '00110001010011010001001000100',
    '10110111110010001011101011000',
    '00001101000001110000011101000',
    '00101110100101101001011010001',
    '10001101110001111100011111000',
    '10110110010110100101101001010',
    '00011100111010101010100010100',
    '10011010010001010101010000111',
    '10011000010011000100111101101',
    '10101010111101100100111110010',
    '00000000001001000011100011101',
    '11111110110101110101101010111',
    '10000010110101110100100011110',
    '10111010110001000111111110101',
    '10111010100110101000011001111',
    '10111010100010101110111011101',
    '10000010000100010001110000110',
    '11111110010001000100110010000'
  ],
  'https://x.co/y': [
    '111111101001001111111',
    '100000100111101000001',
    '101110101001001011101',
    '101110101100001011101',
    '101110101001001011101',
    '100000101000101000001',
    '111111101010101111111',
    '000000000000100000000',
    '001111110000110111101',
    '010100001101000000011',
    '001110100100001010000',
    '011100010111100110110',
    '101011110010001000101',
    '000000000111100001010',
    '111111101110110011101',
    '100000101110011110101',
    '101110101101110111010',
    '101110101101110110011',
    '101110101111011101110',
    '100000100110001010001',
    '111111100100110110000'
  ]
};

function makeImageData(width: number, height: number, fill = 255): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < data.length; index += 4) {
    data[index] = fill;
    data[index + 1] = fill;
    data[index + 2] = fill;
    data[index + 3] = 255;
  }
  return { data, width, height, colorSpace: 'srgb' } as ImageData;
}

function makeQrImageData(value: string, scale: number): ImageData {
  const modules = QR_FIXTURES[value];
  if (!modules) throw new Error(`Missing QR test fixture for ${value}`);
  const quietModules = 4;
  const moduleCount = modules.length;
  const width = (moduleCount + quietModules * 2) * scale;
  const imageData = makeImageData(width, width, 255);

  for (let y = 0; y < width; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const moduleX = Math.floor(x / scale) - quietModules;
      const moduleY = Math.floor(y / scale) - quietModules;
      const isDark = moduleX >= 0
        && moduleY >= 0
        && moduleX < moduleCount
        && moduleY < moduleCount
        && modules[moduleY]?.[moduleX] === '1';
      if (!isDark) continue;

      const offset = (y * width + x) * 4;
      imageData.data[offset] = 0;
      imageData.data[offset + 1] = 0;
      imageData.data[offset + 2] = 0;
    }
  }

  return imageData;
}

beforeEach(() => {
  Reflect.deleteProperty(globalThis, 'BarcodeDetector');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

test('returns no evidence when no QR code is detected', async () => {
  const evidence = await detectQrCue(makeImageData(40, 40), 12);

  expect(evidence).toEqual([]);
});

test('returns QR evidence from jsqr fallback results', async () => {
  const evidence = await detectQrCue(makeQrImageData('https://sponsor.example/offer', 4), 12);

  expect(evidence).toHaveLength(1);
  expect(evidence[0]).toMatchObject({
    source: 'frame-qr-code',
    kind: 'ad-read-presence',
    startSeconds: 12,
    raw: { value: 'https://sponsor.example/offer', detector: 'jsqr' }
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

test('uses native BarcodeDetector results when available', async () => {
  class BarcodeDetectorMock {
    static async getSupportedFormats(): Promise<string[]> {
      return ['qr_code'];
    }

    async detect(): Promise<Array<{ rawValue: string; format: string }>> {
      return [{ rawValue: 'https://native.example/qr', format: 'qr_code' }];
    }
  }

  vi.stubGlobal('BarcodeDetector', BarcodeDetectorMock);

  const evidence = await detectQrCue(makeImageData(40, 40), 12);

  expect(evidence).toHaveLength(1);
  expect(evidence[0]).toMatchObject({
    source: 'frame-qr-code',
    raw: { value: 'https://native.example/qr', detector: 'BarcodeDetector' }
  });
});
