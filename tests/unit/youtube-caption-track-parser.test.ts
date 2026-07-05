import { parseJson3CaptionTrack } from '../../src/platform/youtube/caption-track-parser';

test('parses json3 caption events into transcript cues', () => {
  const cues = parseJson3CaptionTrack({
    events: [
      { tStartMs: 1000, dDurationMs: 2400, segs: [{ utf8: 'Thanks ' }, { utf8: 'to our sponsor' }] },
      { tStartMs: 4000, dDurationMs: 1000, segs: [{ utf8: '\n' }] },
      { tStartMs: 5500, dDurationMs: 1500, segs: [{ utf8: 'Back to the video' }] }
    ]
  });

  expect(cues).toEqual([
    { startSeconds: 1, durationSeconds: 2.4, text: 'Thanks to our sponsor' },
    { startSeconds: 5.5, durationSeconds: 1.5, text: 'Back to the video' }
  ]);
});

test('returns no cues for malformed caption payloads', () => {
  expect(parseJson3CaptionTrack({ events: 'bad' })).toEqual([]);
});
