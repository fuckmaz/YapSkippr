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

test('creates strong visible-link evidence for promotional URLs', () => {
  expect(detectVisibleLinkCueFromText('Use https://brand.example/offer now', 42)).toEqual([
    expect.objectContaining({
      source: 'frame-visible-link',
      kind: 'ad-read-presence',
      startSeconds: 42,
      confidence: 0.72,
      reason: 'Detected sponsor-like link in video text.',
      raw: expect.objectContaining({
        links: ['https://brand.example/offer'],
        text: 'Use https://brand.example/offer now',
        signal: 'sponsor-cta',
        matchedSemantic: 'offer'
      })
    })
  ]);
});

test('downgrades ordinary URLs without promotional semantics', () => {
  expect(detectVisibleLinkCueFromText('Read https://docs.example/guide for setup details.', 42)).toEqual([
    expect.objectContaining({
      confidence: 0.24,
      reason: 'Detected URL in video text, but it has no promotional semantics.',
      raw: expect.objectContaining({
        links: ['https://docs.example/guide'],
        signal: 'low-signal',
        matchedSemantic: null
      })
    })
  ]);
});

test('uses strong surrounding call-to-action semantics for an otherwise generic URL', () => {
  expect(detectVisibleLinkCueFromText('Use code SAMPLE at https://brand.example/creator', 42)[0]).toMatchObject({
    confidence: 0.72,
    raw: {
      signal: 'sponsor-cta',
      matchedSemantic: 'promo code'
    }
  });
});

test('does not promote explicitly negated sponsor text around a generic URL', () => {
  expect(detectVisibleLinkCueFromText('This is not sponsored by https://brand.example/creator', 42)[0]).toMatchObject({
    confidence: 0.24,
    raw: {
      signal: 'low-signal',
      matchedSemantic: null
    }
  });
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

test('recognizes modern and punycode top-level domains without an allowlist', () => {
  expect(
    extractHttpLinks('Try brand.technology/offer, deals.cloud?trial=1, or xn--bcher-kva.example/promo.')
  ).toEqual([
    'https://brand.technology/offer',
    'https://deals.cloud/?trial=1',
    'https://xn--bcher-kva.example/promo'
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
      confidence: 0.58,
      raw: expect.objectContaining({
        links: ['https://sponsor.com/creator'],
        detector: 'transcript',
        signal: 'sponsor-cta'
      })
    })
  ]);
});

test('keeps generic transcript URLs low-signal and labels their true detector channel', () => {
  expect(detectTranscriptLinkCues([
    { startSeconds: 30, durationSeconds: 4, text: 'Visit docs.example/guide to configure the project.' }
  ])).toEqual([
    expect.objectContaining({
      confidence: 0.18,
      raw: expect.objectContaining({
        detector: 'transcript',
        signal: 'low-signal'
      })
    })
  ]);
});
