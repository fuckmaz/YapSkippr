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

  const payload = await response.json();
  return {
    cues: parseJson3CaptionTrack(payload),
    track
  };
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
