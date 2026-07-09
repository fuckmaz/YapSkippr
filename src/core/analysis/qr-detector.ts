import jsQR from 'jsqr';
import type { TimedEvidence } from '../types';

interface BarcodeDetectorLike {
  detect(imageData: ImageData): Promise<Array<{ rawValue?: string; format?: string }>>;
}

type BarcodeDetectorConstructor = new (options?: { formats?: string[] }) => BarcodeDetectorLike;

const MAX_UPSCALED_PIXELS = 1_200_000;

export async function detectQrCue(imageData: ImageData, currentTimeSeconds: number): Promise<TimedEvidence[]> {
  const nativeEvidence = await detectWithNativeBarcodeDetector(imageData, currentTimeSeconds);
  if (nativeEvidence.length > 0) return nativeEvidence;

  const result = jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: 'attemptBoth' });
  if (result?.data) return [createQrEvidence(result.data, currentTimeSeconds, 'jsqr')];

  const upscaled = upscaleForQrRetry(imageData);
  if (!upscaled) return [];

  const upscaledResult = jsQR(upscaled.data, upscaled.width, upscaled.height, { inversionAttempts: 'attemptBoth' });
  if (upscaledResult?.data) return [createQrEvidence(upscaledResult.data, currentTimeSeconds, 'jsqr-upscaled')];

  return [];
}

function createQrEvidence(value: string, currentTimeSeconds: number, detector: 'jsqr' | 'jsqr-upscaled'): TimedEvidence {
  return {
    source: 'frame-qr-code',
    kind: 'ad-read-presence',
    startSeconds: currentTimeSeconds,
    confidence: detector === 'jsqr-upscaled' ? 0.82 : 0.85,
    reason: 'Detected QR code in sampled video frame.',
    raw: {
      value,
      detector
    }
  };
}

function upscaleForQrRetry(imageData: ImageData): ImageData | null {
  const factor = chooseUpscaleFactor(imageData.width, imageData.height);
  if (factor <= 1) return null;

  const width = imageData.width * factor;
  const height = imageData.height * factor;
  const data = new Uint8ClampedArray(width * height * 4);

  for (let y = 0; y < height; y += 1) {
    const sourceY = Math.floor(y / factor);
    for (let x = 0; x < width; x += 1) {
      const sourceX = Math.floor(x / factor);
      const sourceOffset = (sourceY * imageData.width + sourceX) * 4;
      const targetOffset = (y * width + x) * 4;
      data[targetOffset] = imageData.data[sourceOffset] ?? 0;
      data[targetOffset + 1] = imageData.data[sourceOffset + 1] ?? 0;
      data[targetOffset + 2] = imageData.data[sourceOffset + 2] ?? 0;
      data[targetOffset + 3] = imageData.data[sourceOffset + 3] ?? 255;
    }
  }

  return { data, width, height, colorSpace: imageData.colorSpace } as ImageData;
}

function chooseUpscaleFactor(width: number, height: number): number {
  let factor = Math.max(2, Math.ceil(96 / Math.max(1, Math.min(width, height))));
  factor = Math.min(factor, 4);

  while (factor > 1 && width * height * factor * factor > MAX_UPSCALED_PIXELS) {
    factor -= 1;
  }

  return factor;
}

async function detectWithNativeBarcodeDetector(imageData: ImageData, currentTimeSeconds: number): Promise<TimedEvidence[]> {
  const Detector = (globalThis as { BarcodeDetector?: BarcodeDetectorConstructor & { getSupportedFormats?: () => Promise<string[]> } }).BarcodeDetector;
  if (!Detector) return [];

  try {
    if (Detector.getSupportedFormats) {
      const formats = await Detector.getSupportedFormats();
      if (!formats.includes('qr_code')) return [];
    }

    const detector = new Detector({ formats: ['qr_code'] });
    const barcodes = await detector.detect(imageData);
    return barcodes
      .filter((barcode) => barcode.rawValue)
      .map((barcode) => ({
        source: 'frame-qr-code',
        kind: 'ad-read-presence',
        startSeconds: currentTimeSeconds,
        confidence: 0.9,
        reason: 'Detected QR code in sampled video frame.',
        raw: {
          value: barcode.rawValue,
          format: barcode.format,
          detector: 'BarcodeDetector'
        }
      }));
  } catch {
    return [];
  }
}
