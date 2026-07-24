import type { TranscriptCue } from '../../core/types';
import { mountPlayerStatusUi } from '../../ui/player-status-ui';
import type { StatusUiHandle, VideoElementChange, VideoPlatformAdapter } from '../adapter';
import { loadYouTubeTranscriptForPage } from './transcript-provider';
import { getYouTubeVideoIdFromUrl, isYouTubeWatchUrl } from './youtube-url';

export { getYouTubeVideoIdFromUrl, isYouTubeWatchUrl } from './youtube-url';

export function createYouTubeAdapter(doc: Document = document): VideoPlatformAdapter {
  return {
    id: 'youtube',
    matches: isYouTubeWatchUrl,
    getVideoId: () => getYouTubeVideoIdFromUrl(new URL(location.href)),
    getVideoElement: () => doc.querySelector<HTMLVideoElement>('video.html5-main-video'),
    getCurrentTimeSeconds: () => doc.querySelector<HTMLVideoElement>('video.html5-main-video')?.currentTime ?? 0,
    observeVideoChanges: (onChange) => observeVideoElementChanges(doc, onChange),
    loadTranscript: async (): Promise<TranscriptCue[]> => {
      const result = await loadYouTubeTranscriptForPage(new URL(location.href), doc.documentElement.outerHTML);
      return result.cues;
    },
    mountStatusUi: async (): Promise<StatusUiHandle> => mountPlayerStatusUi(doc)
  };
}

function observeVideoElementChanges(doc: Document, onChange: (change: VideoElementChange) => void): () => void {
  const observer = new MutationObserver((records) => {
    onChange({
      removedNodes: records.flatMap((record) => Array.from(record.removedNodes))
    });
  });
  observer.observe(doc.body, { childList: true, subtree: true });
  return () => observer.disconnect();
}
