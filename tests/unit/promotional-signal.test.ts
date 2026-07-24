import {
  classifyPromotionalLinkContext,
  findPromotionalTextSemantic,
  findPromotionalUrlSemantic,
  parseHttpUrlLike
} from '../../src/core/analysis/promotional-signal';

test('finds delimiter-bounded promotional URL semantics', () => {
  expect(findPromotionalUrlSemantic('https://brand.example/creator-offer')).toBe('offer');
  expect(findPromotionalUrlSemantic('brand.example/path?coupon=SAMPLE')).toBe('coupon');
});

test('does not infer promotional meaning from generic or substring-only URLs', () => {
  expect(findPromotionalUrlSemantic('https://docs.example/guide')).toBeNull();
  expect(findPromotionalUrlSemantic('https://sponsorblock.example/docs')).toBeNull();
});

test('requires a plausible domain for scheme-less URL parsing', () => {
  expect(parseHttpUrlLike('brand.example/offer')?.hostname).toBe('brand.example');
  expect(parseHttpUrlLike('https://localhost/offer')?.hostname).toBe('localhost');
  expect(parseHttpUrlLike('HELLO')).toBeNull();
  expect(parseHttpUrlLike('javascript:alert(1)')).toBeNull();
});

test('recognizes strong promotional language but not generic navigation', () => {
  expect(findPromotionalTextSemantic('Use code SAMPLE when you check out.')).toBe('promo code');
  expect(findPromotionalTextSemantic('Get 25% off this week.')).toBe('percentage discount');
  expect(findPromotionalTextSemantic('Visit the settings and check out the graph.')).toBeNull();
  expect(findPromotionalTextSemantic('Save 20 files before closing the editor.')).toBeNull();
});

test('suppresses negated promotions while preserving affirmative not-only phrasing', () => {
  expect(findPromotionalTextSemantic('This is not sponsored by Acme.')).toBeNull();
  expect(findPromotionalTextSemantic('This is not only sponsored by Acme, it was also designed with them.'))
    .toBe('sponsor disclosure');
});

test('prefers URL semantics, then uses surrounding promotional context', () => {
  expect(classifyPromotionalLinkContext(
    'Read the offer details.',
    ['https://brand.example/offer']
  )).toMatchObject({
    signal: 'sponsor-cta',
    matchedSemantic: 'offer'
  });
  expect(classifyPromotionalLinkContext(
    'Use code SAMPLE at this page.',
    ['https://brand.example/creator']
  )).toMatchObject({
    signal: 'sponsor-cta',
    matchedSemantic: 'promo code'
  });
  expect(classifyPromotionalLinkContext(
    'Read the setup guide.',
    ['https://docs.example/guide']
  )).toMatchObject({
    signal: 'low-signal',
    matchedSemantic: null
  });
});
