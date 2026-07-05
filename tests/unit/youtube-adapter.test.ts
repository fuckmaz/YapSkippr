import { getYouTubeVideoIdFromUrl, isYouTubeWatchUrl } from '../../src/platform/youtube/youtube-adapter';

test('matches YouTube watch URLs', () => {
  expect(isYouTubeWatchUrl(new URL('https://www.youtube.com/watch?v=abc123'))).toBe(true);
  expect(isYouTubeWatchUrl(new URL('https://m.youtube.com/watch?v=abc123'))).toBe(true);
  expect(isYouTubeWatchUrl(new URL('https://youtu.be/abc123'))).toBe(true);
  expect(isYouTubeWatchUrl(new URL('https://www.youtube.com/shorts/abc123'))).toBe(false);
});

test('extracts video IDs from supported YouTube URLs', () => {
  expect(getYouTubeVideoIdFromUrl(new URL('https://www.youtube.com/watch?v=abc123&feature=share'))).toBe('abc123');
  expect(getYouTubeVideoIdFromUrl(new URL('https://youtu.be/xyz987?t=10'))).toBe('xyz987');
});
