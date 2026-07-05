import jsQR from 'jsqr';
import type { TimedEvidence } from '../types';

interface BarcodeDetectorLike {
  detect(imageData: ImageData): Promise<Array<{ rawValue?: string; format?: string }>>;
}

type BarcodeDetectorConstructor = new (options?: { formats?: string[] }) => BarcodeDetectorLike;

export async function detectQrCue(imageData: ImageData, currentTimeSeconds: number): Promise<TimedEvidence[]> {
  const nativeEvidence = await detectWithNativeBarcodeDetector(imageData, currentTimeSeconds);
  if (nativeEvidence.length > 0) return nativeEvidence;

  const result = jsQR(imageData.data, imageData.width, imageData.height);
  if (!result) return [];

  return [
    {
      source: 'frame-qr-code',
      kind: 'ad-read-presence',
      startSeconds: currentTimeSeconds,
      confidence: 0.85,
      reason: 'Detected QR code in sampled video frame.',
      raw: {
        value: result.data,
        detector: 'jsqr'
      }
    }
  ];
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
