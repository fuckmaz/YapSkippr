import { detectVisibleLinkCueFromText, extractHttpLinks } from '../../src/core/analysis/link-detector';

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
