import type { TimedEvidence } from '../types';

interface NativeDetectedText {
  rawValue?: string;
  text?: string;
  detectedText?: string;
}

interface NativeTextDetector {
  detect(image: CanvasImageSource): Promise<NativeDetectedText[]>;
}

type NativeTextDetectorConstructor = new () => NativeTextDetector;

const HTTP_LINK_PATTERN = /\bhttps?:\/\/[^\s<>"'`]+/gi;

export async function detectVisibleLinkCue(
  imageData: ImageData,
  currentTimeSeconds: number
): Promise<TimedEvidence[]> {
  const detector = getNativeTextDetector();
  if (!detector || typeof document === 'undefined') return [];

  const canvas = document.createElement('canvas');
  canvas.width = imageData.width;
  canvas.height = imageData.height;

  const context = canvas.getContext('2d');
  if (!context) return [];

  context.putImageData(imageData, 0, 0);

  try {
    const detections = await new detector().detect(canvas);
    const text = detections.map(getDetectedText).filter(Boolean).join(' ');
    return detectVisibleLinkCueFromText(text, currentTimeSeconds);
  } catch {
    return [];
  }
}

export function isVisibleTextDetectionAvailable(): boolean {
  return Boolean(getNativeTextDetector());
}

export function detectVisibleLinkCueFromText(text: string, currentTimeSeconds: number): TimedEvidence[] {
  const links = extractHttpLinks(text);
  if (links.length === 0) return [];

  return [
    {
      source: 'frame-visible-link',
      kind: 'ad-read-presence',
      startSeconds: currentTimeSeconds,
      confidence: 0.72,
      reason: 'Detected visible HTTP link in sampled video frame.',
      raw: {
        links,
        text
      }
    }
  ];
}

export function extractHttpLinks(text: string): string[] {
  const matches = text.match(HTTP_LINK_PATTERN) ?? [];
  const normalized = matches
    .map((link) => link.replace(/[),.;:!?]+$/g, ''))
    .filter((link) => link.length > 'https://'.length);

  return [...new Set(normalized)];
}

function getDetectedText(detection: NativeDetectedText): string {
  return detection.rawValue ?? detection.text ?? detection.detectedText ?? '';
}

function getNativeTextDetector(): NativeTextDetectorConstructor | undefined {
  return (globalThis as typeof globalThis & { TextDetector?: NativeTextDetectorConstructor }).TextDetector;
}
