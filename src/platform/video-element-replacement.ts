import type { VideoElementChange, VideoPlatformAdapter } from './adapter';

const HAVE_METADATA_READY_STATE = 1;

type VideoElementSource = Pick<VideoPlatformAdapter, 'getVideoElement' | 'observeVideoChanges'>;

export function isPlayableVideoElement(video: HTMLVideoElement | null): boolean {
  return video !== null && video.isConnected && video.readyState >= HAVE_METADATA_READY_STATE;
}

export function observePlayableVideoReplacement(
  source: VideoElementSource,
  currentVideo: HTMLVideoElement,
  onReplacement: (replacement: HTMLVideoElement) => void
): () => void {
  let stopped = false;
  let currentVideoWasDetached = !currentVideo.isConnected;
  let pendingCandidate: HTMLVideoElement | null = null;
  let pendingReplacement: HTMLVideoElement | null = null;
  let stopObserving: (() => void) | undefined;

  const handleMetadataLoaded = (): void => inspect();

  const clearPendingCandidate = (): void => {
    pendingCandidate?.removeEventListener('loadedmetadata', handleMetadataLoaded);
    pendingCandidate = null;
  };

  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    clearPendingCandidate();
    stopObserving?.();
    stopObserving = undefined;
  };

  function inspect(change?: VideoElementChange): void {
    if (stopped) return;

    if (!currentVideo.isConnected || change?.removedNodes.some((node) => node === currentVideo || node.contains(currentVideo))) {
      currentVideoWasDetached = true;
    }
    const candidate = source.getVideoElement();
    if (candidate === null || !candidate.isConnected) {
      clearPendingCandidate();
      return;
    }

    if (candidate === currentVideo && !currentVideoWasDetached) {
      clearPendingCandidate();
      return;
    }

    if (isPlayableVideoElement(candidate)) {
      deliverReplacement(candidate);
      return;
    }

    if (candidate === pendingCandidate) return;
    clearPendingCandidate();
    pendingCandidate = candidate;
    pendingCandidate.addEventListener('loadedmetadata', handleMetadataLoaded);
  }

  function deliverReplacement(replacement: HTMLVideoElement): void {
    if (stopObserving === undefined) {
      pendingReplacement = replacement;
      return;
    }
    stop();
    onReplacement(replacement);
  }

  const unsubscribe = source.observeVideoChanges(inspect);
  stopObserving = unsubscribe;
  if (pendingReplacement !== null) {
    const replacement = pendingReplacement;
    pendingReplacement = null;
    stop();
    onReplacement(replacement);
    return stop;
  }
  inspect();
  return stop;
}
