import { summarizeRawEvidence } from '../../src/core/evidence-detail';

test('summarizes visible link raw evidence', () => {
  expect(summarizeRawEvidence({
    links: ['https://brand.example/deal'],
    text: 'Visit https://brand.example/deal'
  })).toBe('https://brand.example/deal');
});

test('summarizes QR raw evidence with decoded value and box location', () => {
  expect(summarizeRawEvidence({
    value: 'https://brand.example/qr',
    detector: 'jsqr',
    location: {
      topLeftCorner: { x: 10.4, y: 20.2 },
      bottomRightCorner: { x: 58.7, y: 69.8 }
    }
  })).toBe('https://brand.example/qr (QR box 10,20 48x50)');
});

test('summarizes progress-bar raw evidence with frame coordinates', () => {
  expect(summarizeRawEvidence({
    y: 29,
    startX: 10,
    endX: 69,
    rows: 3
  })).toBe('Progress bar x=10-69 y=29 rows=3');
});

test('falls back to OCR text-like fields', () => {
  expect(summarizeRawEvidence({ contextText: 'Sponsored by Brand' })).toBe('Sponsored by Brand');
});
