import {
  detectTranscriptLinkCues,
  detectVisibleLinkCueFromText,
  extractHttpLinks
} from '../../src/core/analysis/link-detector';

test('extracts and normalizes displayed http links', () => {
  expect(
    extractHttpLinks('Visit https://sponsor.example/deal, then http://foo.test/path?x=1. Also https://sponsor.example/deal')
  ).toEqual(['https://sponsor.example/deal', 'http://foo.test/path?x=1']);
});

test('creates visible-link evidence for displayed URLs', () => {
  expect(detectVisibleLinkCueFromText('Use https://brand.example/creator now', 42)).toEqual([
    {
      source: 'frame-visible-link',
      kind: 'ad-read-presence',
      startSeconds: 42,
      confidence: 0.72,
      reason: 'Detected visible HTTP link in sampled video frame.',
      raw: {
        links: ['https://brand.example/creator'],
        text: 'Use https://brand.example/creator now'
      }
    }
  ]);
});

test('ignores text without displayed http links', () => {
  expect(detectVisibleLinkCueFromText('follow me on social', 42)).toEqual([]);
});

test('normalizes common onscreen bare-domain and OCR URL formats', () => {
  expect(
    extractHttpLinks('Visit sponsor.example/deal or www.brand . com / creator. Try offer dot co slash start!')
  ).toEqual([
    'https://sponsor.example/deal',
    'https://www.brand.com/creator',
    'https://offer.co/start'
  ]);
});

test('uses transcript text as a cross-browser fallback for sponsor links', () => {
  expect(detectTranscriptLinkCues([
    { startSeconds: 30, durationSeconds: 4, text: 'Visit sponsor dot com slash creator to learn more.' },
    { startSeconds: 34, durationSeconds: 4, text: 'Thanks for watching.' }
  ])).toEqual([
    expect.objectContaining({
      source: 'frame-visible-link',
      kind: 'ad-read-presence',
      startSeconds: 30,
      raw: expect.objectContaining({
        links: ['https://sponsor.com/creator'],
        detector: 'transcript'
      })
    })
  ]);
});
