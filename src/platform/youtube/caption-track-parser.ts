import type { TranscriptCue } from '../../core/types';

interface Json3CaptionEvent {
  tStartMs?: unknown;
  dDurationMs?: unknown;
  segs?: unknown;
}

interface Json3CaptionSegment {
  utf8?: unknown;
}

export function parseJson3CaptionTrack(payload: unknown): TranscriptCue[] {
  if (!isRecord(payload) || !Array.isArray(payload.events)) return [];

  const cues: TranscriptCue[] = [];
  for (const event of payload.events as Json3CaptionEvent[]) {
    if (!isRecord(event) || !Array.isArray(event.segs) || typeof event.tStartMs !== 'number') continue;

    const text = (event.segs as Json3CaptionSegment[])
      .map((segment) => (isRecord(segment) && typeof segment.utf8 === 'string' ? segment.utf8 : ''))
      .join('')
      .replace(/\s+/g, ' ')
      .trim();

    if (!text) continue;

    cues.push({
      startSeconds: event.tStartMs / 1000,
      durationSeconds: typeof event.dDurationMs === 'number' ? event.dDurationMs / 1000 : 0,
      text
    });
  }

  return cues;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
