import jsQR, { type QRCode } from 'jsqr';
import type { TimedEvidence } from '../types';
import {
  findPromotionalUrlSemantic,
  parseHttpUrlLike
} from './promotional-signal';

interface BarcodeDetectorLike {
  detect(image: CanvasImageSource | ImageData): Promise<Array<{ rawValue?: string; format?: string }>>;
}

type BarcodeDetectorConstructor = new (options?: { formats?: string[] }) => BarcodeDetectorLike;
type JsQrDetector = 'jsqr' | 'jsqr-upscaled' | 'jsqr-region' | 'jsqr-region-upscaled';
type QrPayloadType = 'url' | 'promo-code' | 'plain-text';
type QrSignal = 'sponsor-cta' | 'low-signal';

interface QrPayloadClassification {
  signal: QrSignal;
  payloadType: QrPayloadType;
  reason: string;
}

interface QrCoordinateTransform {
  scale: number;
  offsetX: number;
  offsetY: number;
}

interface ImageRegion {
  imageData: ImageData;
  offsetX: number;
  offsetY: number;
}

const MAX_UPSCALED_PIXELS = 1_200_000;
const SPONSOR_QR_CONFIDENCE = 0.85;
const SPONSOR_QR_UPSCALED_CONFIDENCE = 0.82;
const LOW_SIGNAL_QR_CONFIDENCE = 0.32;

export async function detectQrCue(imageData: ImageData, currentTimeSeconds: number): Promise<TimedEvidence[]> {
  const nativeEvidence = await detectWithNativeBarcodeDetector(imageData, currentTimeSeconds);
  if (nativeEvidence.length > 0) return nativeEvidence;

  const result = jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: 'attemptBoth' });
  if (result?.data) return [createQrEvidence(result, currentTimeSeconds, 'jsqr')];

  const upscaled = upscaleForQrRetry(imageData);
  if (upscaled) {
    const upscaledResult = decodeWithJsQr(upscaled.imageData);
    if (upscaledResult?.data) {
      return [createQrEvidence(upscaledResult, currentTimeSeconds, 'jsqr-upscaled', { scale: upscaled.factor, offsetX: 0, offsetY: 0 })];
    }
  }

  for (const region of createQrSearchRegions(imageData)) {
    const regionalResult = decodeWithJsQr(region.imageData);
    if (regionalResult?.data) {
      return [createQrEvidence(regionalResult, currentTimeSeconds, 'jsqr-region', {
        scale: 1,
        offsetX: region.offsetX,
        offsetY: region.offsetY
      })];
    }

    const enhanced = stretchImageContrast(region.imageData);
    const regionalUpscaled = upscaleForQrRetry(enhanced);
    const retryImage = regionalUpscaled?.imageData ?? enhanced;
    const retryResult = decodeWithJsQr(retryImage);
    if (retryResult?.data) {
      return [createQrEvidence(retryResult, currentTimeSeconds, 'jsqr-region-upscaled', {
        scale: regionalUpscaled?.factor ?? 1,
        offsetX: region.offsetX,
        offsetY: region.offsetY
      })];
    }
  }

  return [];
}

function createQrEvidence(
  result: QRCode,
  currentTimeSeconds: number,
  detector: JsQrDetector,
  transform: QrCoordinateTransform = { scale: 1, offsetX: 0, offsetY: 0 }
): TimedEvidence {
  const classification = classifyQrPayload(result.data);
  const baseConfidence = detector.includes('upscaled') ? SPONSOR_QR_UPSCALED_CONFIDENCE : SPONSOR_QR_CONFIDENCE;

  return {
    source: 'frame-qr-code',
    kind: 'ad-read-presence',
    startSeconds: currentTimeSeconds,
    confidence: classification.signal === 'sponsor-cta' ? baseConfidence : LOW_SIGNAL_QR_CONFIDENCE,
    reason: classification.signal === 'sponsor-cta'
      ? 'Detected sponsor-like QR code in sampled video frame.'
      : 'Detected QR code in sampled video frame, but decoded payload is low-signal.',
    raw: {
      value: result.data,
      detector,
      signal: classification.signal,
      payloadType: classification.payloadType,
      classificationReason: classification.reason,
      location: transformQrLocation(result.location, transform)
    }
  };
}

export function classifyQrPayload(value: string): QrPayloadClassification {
  const normalized = value.trim();
  if (isUrlLikeQrPayload(normalized)) {
    const sponsorSemantics = findPromotionalUrlSemantic(normalized);
    return {
      signal: sponsorSemantics ? 'sponsor-cta' : 'low-signal',
      payloadType: 'url',
      reason: sponsorSemantics
        ? `decoded URL contains sponsor CTA semantics (${sponsorSemantics})`
        : 'decoded payload is a generic URL without sponsor CTA semantics'
    };
  }

  if (isPromoCodeLikeQrPayload(normalized)) {
    return {
      signal: 'sponsor-cta',
      payloadType: 'promo-code',
      reason: 'decoded payload looks like a promo code or coupon CTA'
    };
  }

  return {
    signal: 'low-signal',
    payloadType: 'plain-text',
    reason: 'decoded payload is plain text without a URL or promo CTA'
  };
}

function isUrlLikeQrPayload(value: string): boolean {
  return parseHttpUrlLike(value) !== null;
}

function isPromoCodeLikeQrPayload(value: string): boolean {
  if (!value || value.length > 80) return false;
  const upper = value.toUpperCase();
  if (/\b(?:USE\s+)?(?:CODE|COUPON|PROMO|DISCOUNT|SAVE)\b/.test(upper)) return true;
  if (/\b[A-Z0-9]{4,16}\b/.test(upper) && /(?:%|\$|OFF|SAVE|DEAL|GIFT|FREE)/.test(upper)) return true;
  return false;
}

function decodeWithJsQr(imageData: ImageData): QRCode | null {
  return jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: 'attemptBoth' });
}

function createQrSearchRegions(imageData: ImageData): ImageRegion[] {
  if (imageData.width < 180 || imageData.height < 140) return [];
  const regionWidth = Math.min(imageData.width, Math.max(180, Math.round(imageData.width * 0.36)));
  const regionHeight = Math.min(imageData.height, Math.max(140, Math.round(imageData.height * 0.54)));
  const right = imageData.width - regionWidth;
  const bottom = imageData.height - regionHeight;
  const centerX = Math.round(right / 2);
  const centerY = Math.round(bottom / 2);
  const positions = [
    [0, 0],
    [right, 0],
    [0, bottom],
    [right, bottom],
    [centerX, centerY]
  ] as const;

  return positions.map(([x, y]) => ({
    imageData: cropImageData(imageData, x, y, regionWidth, regionHeight),
    offsetX: x,
    offsetY: y
  }));
}

function cropImageData(source: ImageData, left: number, top: number, width: number, height: number): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const sourceStart = ((top + y) * source.width + left) * 4;
    const targetStart = y * width * 4;
    data.set(source.data.subarray(sourceStart, sourceStart + width * 4), targetStart);
  }
  return { data, width, height, colorSpace: source.colorSpace } as ImageData;
}

function stretchImageContrast(source: ImageData): ImageData {
  let darkest = 255;
  let lightest = 0;
  for (let offset = 0; offset < source.data.length; offset += 4) {
    const luminance = pixelLuminance(source.data, offset);
    darkest = Math.min(darkest, luminance);
    lightest = Math.max(lightest, luminance);
  }
  if (lightest - darkest < 24) return source;

  const data = new Uint8ClampedArray(source.data.length);
  const scale = 255 / (lightest - darkest);
  for (let offset = 0; offset < source.data.length; offset += 4) {
    const value = Math.round((pixelLuminance(source.data, offset) - darkest) * scale);
    data[offset] = value;
    data[offset + 1] = value;
    data[offset + 2] = value;
    data[offset + 3] = source.data[offset + 3] ?? 255;
  }
  return { data, width: source.width, height: source.height, colorSpace: source.colorSpace } as ImageData;
}

function pixelLuminance(data: Uint8ClampedArray, offset: number): number {
  return Math.round((data[offset] ?? 0) * 0.299 + (data[offset + 1] ?? 0) * 0.587 + (data[offset + 2] ?? 0) * 0.114);
}

function upscaleForQrRetry(imageData: ImageData): { imageData: ImageData; factor: number } | null {
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

  return {
    imageData: { data, width, height, colorSpace: imageData.colorSpace } as ImageData,
    factor
  };
}

function chooseUpscaleFactor(width: number, height: number): number {
  let factor = Math.max(2, Math.ceil(96 / Math.max(1, Math.min(width, height))));
  factor = Math.min(factor, 4);

  while (factor > 1 && width * height * factor * factor > MAX_UPSCALED_PIXELS) {
    factor -= 1;
  }

  return factor;
}

function transformQrLocation(location: QRCode['location'], transform: QrCoordinateTransform): QRCode['location'] {
  const scaled: QRCode['location'] = {
    topRightCorner: transformPoint(location.topRightCorner, transform),
    topLeftCorner: transformPoint(location.topLeftCorner, transform),
    bottomRightCorner: transformPoint(location.bottomRightCorner, transform),
    bottomLeftCorner: transformPoint(location.bottomLeftCorner, transform),
    topRightFinderPattern: transformPoint(location.topRightFinderPattern, transform),
    topLeftFinderPattern: transformPoint(location.topLeftFinderPattern, transform),
    bottomLeftFinderPattern: transformPoint(location.bottomLeftFinderPattern, transform)
  };

  if (location.bottomRightAlignmentPattern) {
    scaled.bottomRightAlignmentPattern = transformPoint(location.bottomRightAlignmentPattern, transform);
  }

  return scaled;
}

function transformPoint(point: { x: number; y: number }, transform: QrCoordinateTransform): { x: number; y: number } {
  return {
    x: Number((point.x / transform.scale + transform.offsetX).toFixed(2)),
    y: Number((point.y / transform.scale + transform.offsetY).toFixed(2))
  };
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
    const barcodes = await detector.detect(toBarcodeDetectorSource(imageData));
    return barcodes
      .filter((barcode) => barcode.rawValue)
      .map((barcode) => {
        const classification = classifyQrPayload(barcode.rawValue ?? '');
        return {
          source: 'frame-qr-code',
          kind: 'ad-read-presence',
          startSeconds: currentTimeSeconds,
          confidence: classification.signal === 'sponsor-cta' ? 0.9 : LOW_SIGNAL_QR_CONFIDENCE,
          reason: classification.signal === 'sponsor-cta'
            ? 'Detected sponsor-like QR code in sampled video frame.'
            : 'Detected QR code in sampled video frame, but decoded payload is low-signal.',
          raw: {
            value: barcode.rawValue,
            format: barcode.format,
            detector: 'BarcodeDetector',
            signal: classification.signal,
            payloadType: classification.payloadType,
            classificationReason: classification.reason
          }
        };
      });
  } catch {
    return [];
  }
}

function toBarcodeDetectorSource(imageData: ImageData): CanvasImageSource | ImageData {
  if (typeof document === 'undefined') return imageData;
  const canvas = document.createElement('canvas');
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  const context = canvas.getContext('2d');
  if (!context) return imageData;
  context.putImageData(imageData, 0, 0);
  return canvas;
}
