import type { TranscriptCue } from '../../core/types';
import { parseJson3CaptionTrack } from './caption-track-parser';
import { extractCaptionTracksFromHtml, type YouTubeCaptionTrack } from './page-data-extractor';

export interface TranscriptLoadResult {
  cues: TranscriptCue[];
  track?: YouTubeCaptionTrack;
}

export async function loadYouTubeTranscript(
  html: string,
  fetcher: typeof fetch = fetch
): Promise<TranscriptLoadResult> {
  const tracks = extractCaptionTracksFromHtml(html);
  const track = selectCaptionTrack(tracks);
  if (!track) return { cues: [] };

  const response = await fetcher(toJson3CaptionUrl(track.baseUrl));
  if (!response.ok) {
    throw new Error(`Caption request failed with HTTP ${response.status}.`);
  }

  const payload = await readCaptionPayload(response);
  return {
    cues: parseJson3CaptionTrack(payload),
    track
  };
}

export async function loadYouTubeTranscriptForPage(
  pageUrl: URL,
  fallbackHtml: string,
  fetcher: typeof fetch = fetch
): Promise<TranscriptLoadResult> {
  const freshHtml = await fetchPageHtml(pageUrl, fetcher);
  if (freshHtml) {
    const freshResult = await loadYouTubeTranscript(freshHtml, fetcher);
    if (freshResult.track || freshResult.cues.length > 0) {
      return freshResult;
    }
  }

  return loadYouTubeTranscript(fallbackHtml, fetcher);
}

export function selectCaptionTrack(tracks: YouTubeCaptionTrack[]): YouTubeCaptionTrack | undefined {
  return (
    tracks.find((track) => track.languageCode.toLowerCase().startsWith('en') && track.kind !== 'asr') ??
    tracks.find((track) => track.languageCode.toLowerCase().startsWith('en')) ??
    tracks[0]
  );
}

export function toJson3CaptionUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  url.searchParams.set('fmt', 'json3');
  return url.toString();
}

async function fetchPageHtml(pageUrl: URL, fetcher: typeof fetch): Promise<string | null> {
  try {
    const response = await fetcher(pageUrl.toString(), { credentials: 'include' });
    if (!response.ok) return null;
    return response.text();
  } catch {
    return null;
  }
}

async function readCaptionPayload(response: Response): Promise<unknown> {
  const body = await response.text();
  if (!body.trim()) return null;

  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}
