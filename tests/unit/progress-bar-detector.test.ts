import { detectProgressBarCue } from '../../src/core/analysis/progress-bar-detector';

function makeImageData(width: number, height: number, fill = 20): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < data.length; index += 4) {
    data[index] = fill;
    data[index + 1] = fill;
    data[index + 2] = fill;
    data[index + 3] = 255;
  }
  return { data, width, height, colorSpace: 'srgb' } as ImageData;
}

function drawHorizontalLine(imageData: ImageData, y: number, startX: number, endX: number, value = 245): void {
  for (let x = startX; x <= endX; x += 1) {
    const offset = (y * imageData.width + x) * 4;
    imageData.data[offset] = value;
    imageData.data[offset + 1] = value;
    imageData.data[offset + 2] = value;
  }
}

test('detects a long bright horizontal progress bar away from YouTube controls', () => {
  const imageData = makeImageData(100, 80);
  drawHorizontalLine(imageData, 29, 10, 89);
  drawHorizontalLine(imageData, 30, 10, 89);
  drawHorizontalLine(imageData, 31, 10, 89);

  const evidence = detectProgressBarCue(imageData, 42);

  expect(evidence).toHaveLength(1);
  expect(evidence[0]).toMatchObject({
    source: 'frame-progress-bar',
    kind: 'ad-read-presence',
    startSeconds: 42
  });
  expect(evidence[0]?.confidence).toBeGreaterThan(0.5);
});

test('ignores short horizontal lines', () => {
  const imageData = makeImageData(100, 80);
  drawHorizontalLine(imageData, 30, 10, 18);

  const evidence = detectProgressBarCue(imageData, 42);

  expect(evidence).toEqual([]);
});

test('ignores likely YouTube control bar near the bottom', () => {
  const imageData = makeImageData(100, 100);
  drawHorizontalLine(imageData, 84, 5, 95);
  drawHorizontalLine(imageData, 85, 5, 95);
  drawHorizontalLine(imageData, 86, 5, 95);

  const evidence = detectProgressBarCue(imageData, 42);

  expect(evidence).toEqual([]);
});

test('ignores single-pixel horizontal separators', () => {
  const imageData = makeImageData(100, 80);
  drawHorizontalLine(imageData, 30, 10, 89);

  const evidence = detectProgressBarCue(imageData, 42);

  expect(evidence).toEqual([]);
});

test('raises confidence when matching horizontal bars persist across neighboring rows', () => {
  const twoRows = makeImageData(100, 80);
  drawHorizontalLine(twoRows, 30, 10, 89);
  drawHorizontalLine(twoRows, 31, 10, 89);

  const fourRows = makeImageData(100, 80);
  drawHorizontalLine(fourRows, 29, 10, 89);
  drawHorizontalLine(fourRows, 30, 10, 89);
  drawHorizontalLine(fourRows, 31, 10, 89);
  drawHorizontalLine(fourRows, 32, 10, 89);

  const twoRowEvidence = detectProgressBarCue(twoRows, 42);
  const fourRowEvidence = detectProgressBarCue(fourRows, 42);

  expect(fourRowEvidence[0]?.confidence).toBeGreaterThan(twoRowEvidence[0]?.confidence ?? 0);
});
