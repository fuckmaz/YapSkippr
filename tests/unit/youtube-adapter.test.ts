import { createYouTubeAdapter, getYouTubeVideoIdFromUrl, isYouTubeWatchUrl } from '../../src/platform/youtube/youtube-adapter';

test('matches YouTube watch URLs', () => {
  expect(isYouTubeWatchUrl(new URL('https://www.youtube.com/watch?v=abc123'))).toBe(true);
  expect(isYouTubeWatchUrl(new URL('https://m.youtube.com/watch?v=abc123'))).toBe(true);
  expect(isYouTubeWatchUrl(new URL('https://youtu.be/abc123'))).toBe(true);
  expect(isYouTubeWatchUrl(new URL('https://www.youtube.com/shorts/abc123'))).toBe(false);
  expect(isYouTubeWatchUrl(new URL('https://www.youtube.com/feed/subscriptions'))).toBe(false);
});

test('extracts video IDs from supported YouTube URLs', () => {
  expect(getYouTubeVideoIdFromUrl(new URL('https://www.youtube.com/watch?v=abc123&feature=share'))).toBe('abc123');
  expect(getYouTubeVideoIdFromUrl(new URL('https://youtu.be/xyz987?t=10'))).toBe('xyz987');
});

test('reports removed nodes from a batch of video DOM mutations', () => {
  let mutationCallback: MutationCallback | undefined;
  const observe = vi.fn();
  const disconnect = vi.fn();
  vi.stubGlobal('MutationObserver', class {
    constructor(callback: MutationCallback) {
      mutationCallback = callback;
    }

    observe = observe;
    disconnect = disconnect;
  });
  const body = {} as HTMLElement;
  const adapter = createYouTubeAdapter({ body } as Document);
  const onChange = vi.fn();
  const firstRemoved = {} as Node;
  const secondRemoved = {} as Node;

  const stop = adapter.observeVideoChanges(onChange);
  mutationCallback?.([
    { removedNodes: [firstRemoved] } as unknown as MutationRecord,
    { removedNodes: [secondRemoved] } as unknown as MutationRecord
  ], {} as MutationObserver);

  expect(observe).toHaveBeenCalledWith(body, { childList: true, subtree: true });
  expect(onChange).toHaveBeenCalledWith({ removedNodes: [firstRemoved, secondRemoved] });

  stop();
  expect(disconnect).toHaveBeenCalledTimes(1);
  vi.unstubAllGlobals();
});
