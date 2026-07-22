import type { TimedEvidence, TranscriptCue } from '../types';

interface NativeDetectedText {
  rawValue?: string;
  text?: string;
  detectedText?: string;
}

interface NativeTextDetector {
  detect(image: CanvasImageSource): Promise<NativeDetectedText[]>;
}

type NativeTextDetectorConstructor = new () => NativeTextDetector;

const LINK_TLDS = [
  'ai', 'app', 'at', 'be', 'biz', 'cc', 'ch', 'co', 'com', 'de', 'dev', 'edu', 'es', 'eu',
  'example', 'fr', 'gg', 'io', 'it', 'ly', 'me', 'net', 'nl', 'org', 'shop', 'store', 'test',
  'tv', 'uk', 'us'
] as const;
const LINK_PATTERN = new RegExp(
  `\\b(?:https?:\\/\\/)?(?:www\\.)?(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+(?:${[...LINK_TLDS].sort((a, b) => b.length - a.length).join('|')})(?:\\/[^\\s<>"']+)?`,
  'gi'
);

interface TextLinkEvidenceOptions {
  detector?: 'TextDetector' | 'transcript';
  confidence?: number;
  reason?: string;
}

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
    return detectVisibleLinkCueFromText(text, currentTimeSeconds, {
      detector: 'TextDetector',
      reason: 'Detected a visible sponsor link in the sampled video frame.'
    });
  } catch {
    return [];
  }
}

export function isVisibleTextDetectionAvailable(): boolean {
  return Boolean(getNativeTextDetector());
}

export function detectVisibleLinkCueFromText(
  text: string,
  currentTimeSeconds: number,
  options: TextLinkEvidenceOptions = {}
): TimedEvidence[] {
  const links = extractHttpLinks(text);
  if (links.length === 0) return [];

  return [
    {
      source: 'frame-visible-link',
      kind: 'ad-read-presence',
      startSeconds: currentTimeSeconds,
      confidence: options.confidence ?? 0.72,
      reason: options.reason ?? 'Detected visible HTTP link in sampled video frame.',
      raw: {
        links,
        text,
        ...(options.detector ? { detector: options.detector } : {})
      }
    }
  ];
}

export function detectTranscriptLinkCues(cues: readonly TranscriptCue[]): TimedEvidence[] {
  return cues.flatMap((cue) => detectVisibleLinkCueFromText(cue.text, cue.startSeconds, {
    detector: 'transcript',
    confidence: 0.58,
    reason: 'Detected a sponsor link in YouTube transcript text.'
  }));
}

export function extractHttpLinks(text: string): string[] {
  const normalizedText = normalizeOcrLinkText(text);
  const normalized = [...normalizedText.matchAll(LINK_PATTERN)]
    .filter((match) => normalizedText[(match.index ?? 0) - 1] !== '@')
    .map((match) => normalizeLink(match[0]))
    .filter((link): link is string => link !== null);

  const seen = new Set<string>();
  return normalized.filter((link) => {
    const key = link.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeOcrLinkText(text: string): string {
  return text
    .replace(/\s*(?:\[dot\]|\(dot\)|\bdot\b)\s*/gi, '.')
    .replace(/([A-Za-z])\s+\.\s*([A-Za-z])/g, '$1.$2')
    .replace(/([A-Za-z])\s*\.\s+([a-z])/g, '$1.$2')
    .replace(/\s*(?:\bslash\b|\/)\s*/gi, '/')
    .replace(/https?\s*:\s*\/\s*\//gi, (match) => match.toLowerCase().startsWith('https') ? 'https://' : 'http://');
}

function normalizeLink(value: string): string | null {
  const trimmed = value.replace(/[),.;:!?]+$/g, '');
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withScheme);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function getDetectedText(detection: NativeDetectedText): string {
  return detection.rawValue ?? detection.text ?? detection.detectedText ?? '';
}

function getNativeTextDetector(): NativeTextDetectorConstructor | undefined {
  return (globalThis as typeof globalThis & { TextDetector?: NativeTextDetectorConstructor }).TextDetector;
}
