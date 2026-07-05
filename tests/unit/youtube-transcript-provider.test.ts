import { loadYouTubeTranscriptForPage } from '../../src/platform/youtube/transcript-provider';

const stalePageHtml = `
  <script>
    var ytInitialPlayerResponse = {
      "captions": {
        "playerCaptionsTracklistRenderer": {
          "captionTracks": [
            { "baseUrl": "https://captions.example/stale?fmt=srv3", "languageCode": "en", "name": { "simpleText": "English" } }
          ]
        }
      }
    };
  </script>
`;

const freshPageHtml = `
  <script>
    var ytInitialPlayerResponse = {
      "captions": {
        "playerCaptionsTracklistRenderer": {
          "captionTracks": [
            { "baseUrl": "https://captions.example/fresh?fmt=srv3", "languageCode": "en", "name": { "simpleText": "English" } }
          ]
        }
      }
    };
  </script>
`;

test('loads transcript from freshly fetched watch page HTML before using fallback DOM HTML', async () => {
  const fetcher = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === 'https://www.youtube.com/watch?v=fresh') {
      return new Response(freshPageHtml, { status: 200 });
    }
    if (url.startsWith('https://captions.example/fresh')) {
      return Response.json({
        events: [{ tStartMs: 2000, dDurationMs: 1000, segs: [{ utf8: 'fresh sponsor cue' }] }]
      });
    }
    if (url.startsWith('https://captions.example/stale')) {
      return Response.json({
        events: [{ tStartMs: 1000, dDurationMs: 1000, segs: [{ utf8: 'stale sponsor cue' }] }]
      });
    }
    return new Response('', { status: 404 });
  });

  const result = await loadYouTubeTranscriptForPage(
    new URL('https://www.youtube.com/watch?v=fresh'),
    stalePageHtml,
    fetcher as typeof fetch
  );

  expect(result.track?.baseUrl).toBe('https://captions.example/fresh?fmt=srv3');
  expect(result.cues).toEqual([{ startSeconds: 2, durationSeconds: 1, text: 'fresh sponsor cue' }]);
});

test('falls back to DOM HTML when fetching the watch page fails', async () => {
  const fetcher = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === 'https://www.youtube.com/watch?v=fresh') {
      throw new Error('offline');
    }
    if (url.startsWith('https://captions.example/stale')) {
      return Response.json({
        events: [{ tStartMs: 1000, dDurationMs: 1000, segs: [{ utf8: 'fallback sponsor cue' }] }]
      });
    }
    return new Response('', { status: 404 });
  });

  const result = await loadYouTubeTranscriptForPage(
    new URL('https://www.youtube.com/watch?v=fresh'),
    stalePageHtml,
    fetcher as typeof fetch
  );

  expect(result.track?.baseUrl).toBe('https://captions.example/stale?fmt=srv3');
  expect(result.cues).toEqual([{ startSeconds: 1, durationSeconds: 1, text: 'fallback sponsor cue' }]);
});

test('treats empty caption responses as unavailable transcript cues', async () => {
  const fetcher = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === 'https://www.youtube.com/watch?v=fresh') {
      return new Response(freshPageHtml, { status: 200 });
    }
    if (url.startsWith('https://captions.example/fresh')) {
      return new Response('', { status: 200 });
    }
    return new Response('', { status: 404 });
  });

  const result = await loadYouTubeTranscriptForPage(
    new URL('https://www.youtube.com/watch?v=fresh'),
    stalePageHtml,
    fetcher as typeof fetch
  );

  expect(result.track?.baseUrl).toBe('https://captions.example/fresh?fmt=srv3');
  expect(result.cues).toEqual([]);
});

test('treats invalid caption JSON as unavailable transcript cues', async () => {
  const fetcher = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === 'https://www.youtube.com/watch?v=fresh') {
      return new Response(freshPageHtml, { status: 200 });
    }
    if (url.startsWith('https://captions.example/fresh')) {
      return new Response('<html>not json</html>', { status: 200 });
    }
    return new Response('', { status: 404 });
  });

  const result = await loadYouTubeTranscriptForPage(
    new URL('https://www.youtube.com/watch?v=fresh'),
    stalePageHtml,
    fetcher as typeof fetch
  );

  expect(result.track?.baseUrl).toBe('https://captions.example/fresh?fmt=srv3');
  expect(result.cues).toEqual([]);
});
