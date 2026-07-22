import {
  isPlayableVideoElement,
  observePlayableVideoReplacement
} from '../../src/platform/video-element-replacement';
import type { VideoElementChange } from '../../src/platform/adapter';

test('only treats connected video elements with metadata as playable', () => {
  expect(isPlayableVideoElement(null)).toBe(false);
  expect(isPlayableVideoElement(createVideo(false, 1))).toBe(false);
  expect(isPlayableVideoElement(createVideo(true, 0))).toBe(false);
  expect(isPlayableVideoElement(createVideo(true, 1))).toBe(true);
  expect(isPlayableVideoElement(createVideo(true, 4))).toBe(true);
});

test('detects an immediately available playable replacement exactly once', () => {
  const currentVideo = createVideo(true, 4);
  const replacement = createVideo(true, 1);
  const source = createSource(replacement);
  const onReplacement = vi.fn();

  observePlayableVideoReplacement(source, currentVideo, onReplacement);

  expect(onReplacement).toHaveBeenCalledTimes(1);
  expect(onReplacement).toHaveBeenCalledWith(replacement);
  expect(source.stopObserving).toHaveBeenCalledTimes(1);

  source.notify();
  expect(onReplacement).toHaveBeenCalledTimes(1);
});

test('treats a detached then reconnected current video as a recovery handoff', () => {
  const currentVideo = createVideo(true, 4);
  const source = createSource(currentVideo);
  const onReplacement = vi.fn(() => {
    expect(source.stopObserving).toHaveBeenCalledTimes(1);
  });

  observePlayableVideoReplacement(source, currentVideo, onReplacement);
  setVideoState(currentVideo, false, 0);
  source.setCurrent(null);
  source.notify();
  setVideoState(currentVideo, true, 1);
  source.setCurrent(currentVideo);
  source.notify();

  expect(onReplacement).toHaveBeenCalledTimes(1);
  expect(onReplacement).toHaveBeenCalledWith(currentVideo);
  source.notify();
  expect(onReplacement).toHaveBeenCalledTimes(1);
});

test('ignores ordinary mutations when the current video was never detached', () => {
  const currentVideo = createVideo(true, 4);
  const source = createSource(currentVideo);
  const onReplacement = vi.fn();

  observePlayableVideoReplacement(source, currentVideo, onReplacement);
  source.notify();
  source.notify();
  source.notify();

  expect(onReplacement).not.toHaveBeenCalled();
  expect(source.stopObserving).not.toHaveBeenCalled();
});

test('detects a batched same-node remove and reinsert from removed ancestor evidence', () => {
  const currentVideo = createVideo(true, 4);
  const removedAncestor = {
    contains: vi.fn((node: Node) => node === currentVideo)
  } as unknown as Node;
  const unrelatedRemoval = {
    contains: vi.fn(() => false)
  } as unknown as Node;
  const source = createSource(currentVideo);
  const onReplacement = vi.fn(() => {
    expect(source.stopObserving).toHaveBeenCalledTimes(1);
  });

  observePlayableVideoReplacement(source, currentVideo, onReplacement);
  source.notify({ removedNodes: [unrelatedRemoval, removedAncestor] });

  expect(currentVideo.isConnected).toBe(true);
  expect(removedAncestor.contains).toHaveBeenCalledWith(currentVideo);
  expect(onReplacement).toHaveBeenCalledTimes(1);
  expect(onReplacement).toHaveBeenCalledWith(currentVideo);
});

test('ignores batched removals unrelated to the bound video', () => {
  const currentVideo = createVideo(true, 4);
  const unrelatedRemoval = {
    contains: vi.fn(() => false)
  } as unknown as Node;
  const source = createSource(currentVideo);
  const onReplacement = vi.fn();

  observePlayableVideoReplacement(source, currentVideo, onReplacement);
  source.notify({ removedNodes: [unrelatedRemoval] });

  expect(onReplacement).not.toHaveBeenCalled();
  expect(source.stopObserving).not.toHaveBeenCalled();
});

test('ignores null, current, disconnected, and unready replacement candidates', () => {
  const currentVideo = createVideo(true, 4);
  const disconnected = createVideo(false, 4);
  const unready = createVideo(true, 0);
  const replacement = createVideo(true, 1);
  const source = createSource(null);
  const onReplacement = vi.fn();

  observePlayableVideoReplacement(source, currentVideo, onReplacement);
  source.setCurrent(currentVideo);
  source.notify();
  source.setCurrent(disconnected);
  source.notify();
  source.setCurrent(unready);
  source.notify();

  expect(onReplacement).not.toHaveBeenCalled();

  source.setCurrent(replacement);
  source.notify();
  expect(onReplacement).toHaveBeenCalledTimes(1);
  expect(onReplacement).toHaveBeenCalledWith(replacement);
});

test('tracks only one pending metadata candidate and cleans up the previous listener', () => {
  const currentVideo = createVideo(true, 4);
  const firstCandidate = createVideo(true, 0);
  const secondCandidate = createVideo(true, 0);
  const firstAdd = vi.spyOn(firstCandidate, 'addEventListener');
  const firstRemove = vi.spyOn(firstCandidate, 'removeEventListener');
  const secondAdd = vi.spyOn(secondCandidate, 'addEventListener');
  const secondRemove = vi.spyOn(secondCandidate, 'removeEventListener');
  const source = createSource(firstCandidate);
  const onReplacement = vi.fn();

  observePlayableVideoReplacement(source, currentVideo, onReplacement);
  source.notify();
  expect(firstAdd).toHaveBeenCalledTimes(1);

  source.setCurrent(secondCandidate);
  source.notify();
  expect(firstRemove).toHaveBeenCalledTimes(1);
  expect(secondAdd).toHaveBeenCalledTimes(1);

  setVideoState(firstCandidate, true, 1);
  firstCandidate.dispatchEvent(new Event('loadedmetadata'));
  expect(onReplacement).not.toHaveBeenCalled();

  setVideoState(secondCandidate, true, 1);
  secondCandidate.dispatchEvent(new Event('loadedmetadata'));
  expect(onReplacement).toHaveBeenCalledWith(secondCandidate);
  expect(secondRemove).toHaveBeenCalledTimes(1);
  expect(source.stopObserving).toHaveBeenCalledTimes(1);
});

test('completed scan cleanup is idempotent and prevents later replacement observation', () => {
  const currentVideo = createVideo(true, 4);
  const candidate = createVideo(true, 0);
  const removeListener = vi.spyOn(candidate, 'removeEventListener');
  const source = createSource(candidate);
  const onReplacement = vi.fn();

  const stop = observePlayableVideoReplacement(source, currentVideo, onReplacement);
  stop();
  stop();
  setVideoState(candidate, true, 1);
  candidate.dispatchEvent(new Event('loadedmetadata'));
  source.setCurrent(createVideo(true, 4));
  source.notify();

  expect(removeListener).toHaveBeenCalledTimes(1);
  expect(source.stopObserving).toHaveBeenCalledTimes(1);
  expect(onReplacement).not.toHaveBeenCalled();
});

test('completed scan cleanup suppresses a same-node reconnect after detachment', () => {
  const currentVideo = createVideo(true, 4);
  const source = createSource(currentVideo);
  const onReplacement = vi.fn();
  const stop = observePlayableVideoReplacement(source, currentVideo, onReplacement);

  setVideoState(currentVideo, false, 0);
  source.setCurrent(null);
  source.notify();
  setVideoState(currentVideo, true, 0);
  source.setCurrent(currentVideo);
  source.notify();
  stop();
  setVideoState(currentVideo, true, 1);
  currentVideo.dispatchEvent(new Event('loadedmetadata'));
  source.notify();

  expect(source.stopObserving).toHaveBeenCalledTimes(1);
  expect(onReplacement).not.toHaveBeenCalled();
});

test('cleans up even when the platform observer reports synchronously during registration', () => {
  const currentVideo = createVideo(true, 4);
  const replacement = createVideo(true, 1);
  const stopObserving = vi.fn();
  const onReplacement = vi.fn(() => {
    expect(stopObserving).toHaveBeenCalledTimes(1);
  });
  const source = {
    getVideoElement: () => replacement,
    observeVideoChanges(onChange: (change: VideoElementChange) => void) {
      onChange({ removedNodes: [] });
      return stopObserving;
    }
  };

  const stop = observePlayableVideoReplacement(source, currentVideo, onReplacement);
  stop();

  expect(onReplacement).toHaveBeenCalledTimes(1);
  expect(stopObserving).toHaveBeenCalledTimes(1);
});

function createVideo(isConnected: boolean, readyState: number): HTMLVideoElement {
  const video = new EventTarget() as HTMLVideoElement;
  Object.defineProperties(video, {
    isConnected: { configurable: true, value: isConnected, writable: true },
    readyState: { configurable: true, value: readyState, writable: true }
  });
  return video;
}

function setVideoState(video: HTMLVideoElement, isConnected: boolean, readyState: number): void {
  Object.defineProperties(video, {
    isConnected: { configurable: true, value: isConnected, writable: true },
    readyState: { configurable: true, value: readyState, writable: true }
  });
}

function createSource(initialVideo: HTMLVideoElement | null): {
  getVideoElement(): HTMLVideoElement | null;
  observeVideoChanges(onChange: (change: VideoElementChange) => void): () => void;
  notify(change?: VideoElementChange): void;
  setCurrent(video: HTMLVideoElement | null): void;
  stopObserving: ReturnType<typeof vi.fn>;
} {
  let currentVideo = initialVideo;
  let listener: ((change: VideoElementChange) => void) | undefined;
  const stopObserving = vi.fn(() => {
    listener = undefined;
  });

  return {
    getVideoElement: () => currentVideo,
    observeVideoChanges(onChange) {
      listener = onChange;
      return stopObserving;
    },
    notify(change = { removedNodes: [] }) {
      listener?.(change);
    },
    setCurrent(video) {
      currentVideo = video;
    },
    stopObserving
  };
}
