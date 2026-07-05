import { extractCaptionTracksFromHtml } from '../../src/platform/youtube/page-data-extractor';

test('extracts caption tracks from ytInitialPlayerResponse script JSON', () => {
  const html = `
    <html>
      <script>
        var ytInitialPlayerResponse = {
          "captions": {
            "playerCaptionsTracklistRenderer": {
              "captionTracks": [
                { "baseUrl": "https://example.test/captions?fmt=srv3", "languageCode": "en", "name": { "simpleText": "English" } }
              ]
            }
          }
        };
      </script>
    </html>
  `;

  const tracks = extractCaptionTracksFromHtml(html);

  expect(tracks).toEqual([
    {
      baseUrl: 'https://example.test/captions?fmt=srv3',
      languageCode: 'en',
      name: 'English',
      kind: undefined
    }
  ]);
});

test('returns no tracks when player response is missing', () => {
  expect(extractCaptionTracksFromHtml('<html></html>')).toEqual([]);
});
