import type { TranscriptCue } from '../../core/types';
import { mountPlayerStatusUi } from '../../ui/player-status-ui';
import type { StatusUiHandle, VideoPlatformAdapter } from '../adapter';
import { loadYouTubeTranscript } from './transcript-provider';

export function createYouTubeAdapter(doc: Document = document): VideoPlatformAdapter {
  return {
    id: 'youtube',
    matches: isYouTubeWatchUrl,
    getVideoId: () => getYouTubeVideoIdFromUrl(new URL(location.href)),
    getVideoElement: () => doc.querySelector<HTMLVideoElement>('video.html5-main-video'),
    getCurrentTimeSeconds: () => doc.querySelector<HTMLVideoElement>('video.html5-main-video')?.currentTime ?? 0,
    observeVideoChanges: (onChange) => observeVideoElementChanges(doc, onChange),
    loadTranscript: async (): Promise<TranscriptCue[]> => {
      const result = await loadYouTubeTranscript(doc.documentElement.outerHTML);
      return result.cues;
    },
    mountStatusUi: async (): Promise<StatusUiHandle> => mountPlayerStatusUi(doc)
  };
}

export function isYouTubeWatchUrl(url: URL): boolean {
  const hostname = url.hostname.toLowerCase();
  if (hostname === 'youtu.be') return url.pathname.length > 1;
  return (hostname === 'youtube.com' || hostname.endsWith('.youtube.com')) && url.pathname === '/watch' && url.searchParams.has('v');
}

export function getYouTubeVideoIdFromUrl(url: URL): string | null {
  if (url.hostname.toLowerCase() === 'youtu.be') {
    return decodeURIComponent(url.pathname.slice(1).split('/')[0] ?? '') || null;
  }
  return url.searchParams.get('v');
}

function observeVideoElementChanges(doc: Document, onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(doc.body, { childList: true, subtree: true });
  return () => observer.disconnect();
}
