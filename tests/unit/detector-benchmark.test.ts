import { join } from 'node:path';
import { afterEach, beforeEach } from 'vitest';
import { buildSegmentCandidates } from '../../src/core/analysis/evidence-fusion';
import { detectQrCue } from '../../src/core/analysis/qr-detector';
import {
  createProgressBarTracker,
  detectProgressBarCue
} from '../../src/core/analysis/progress-bar-detector';
import type { EvidenceSource, TimedEvidence } from '../../src/core/types';
import { loadPngFixture } from '../fixtures/png-fixture-loader';

type DetectorSource = Extract<EvidenceSource, 'frame-progress-bar' | 'frame-qr-code'>;

interface DetectorFixture {
  id: string;
  source: DetectorSource;
  frameFiles: readonly string[];
  expectedCandidateSources: readonly DetectorSource[];
  supportingEvidence?: readonly TimedEvidence[];
  expectedRawDetection?: boolean;
  notes: string;
}

interface SourceMetrics {
  expected: number;
  detected: number;
  missed: number;
  falsePositive: number;
  recall: number;
  precision: number;
}

interface DetectorFixtureOutcome {
  id: string;
  notes: string;
  rawDetectedSources: DetectorSource[];
  expectedCandidateSources: DetectorSource[];
  detectedCandidateSources: DetectorSource[];
}

interface DetectorBenchmarkResult {
  metrics: Record<DetectorSource, SourceMetrics>;
  fixtureOutcomes: DetectorFixtureOutcome[];
}

const FIXTURE_DIRECTORY = join(process.cwd(), 'tests/fixtures');
const MIN_RECALL: Record<DetectorSource, number> = {
  'frame-progress-bar': 0.9,
  'frame-qr-code': 0.9
};
const MIN_PRECISION: Record<DetectorSource, number> = {
  'frame-progress-bar': 0.95,
  'frame-qr-code': 0.95
};

beforeEach(() => {
  Reflect.deleteProperty(globalThis, 'BarcodeDetector');
});

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'BarcodeDetector');
});

test('committed PNG detector corpus meets per-source precision and recall gates', async () => {
  const results = await runDetectorBenchmark(CORPUS);
  const report = formatBenchmarkReport(results);

  for (const source of ['frame-qr-code', 'frame-progress-bar'] as const) {
    expect(results.metrics[source].recall, report).toBeGreaterThanOrEqual(MIN_RECALL[source]);
    expect(results.metrics[source].precision, report).toBeGreaterThanOrEqual(MIN_PRECISION[source]);
  }

  const rawDetectionRegressions = results.fixtureOutcomes.filter((outcome) => {
    const fixture = CORPUS.find((candidate) => candidate.id === outcome.id);
    return fixture?.expectedRawDetection !== undefined
      && outcome.rawDetectedSources.includes(fixture.source) !== fixture.expectedRawDetection;
  });
  expect(rawDetectionRegressions, report).toEqual([]);
});

async function runDetectorBenchmark(fixtures: readonly DetectorFixture[]): Promise<DetectorBenchmarkResult> {
  const counts = createEmptyCounts();
  const fixtureOutcomes: DetectorFixtureOutcome[] = [];

  for (const fixture of fixtures) {
    const frames = await Promise.all(fixture.frameFiles.map((file) => loadPngFixture(join(FIXTURE_DIRECTORY, file))));
    const rawEvidence = await runRawDetector(fixture.source, frames);
    const candidates = buildSegmentCandidates([...(fixture.supportingEvidence ?? []), ...rawEvidence]);
    const expected = new Set(fixture.expectedCandidateSources);
    const detected = new Set(candidates.flatMap((candidate) => candidate.evidence.map((item) => item.source)).filter(isDetectorSource));
    fixtureOutcomes.push({
      id: fixture.id,
      notes: fixture.notes,
      rawDetectedSources: [...new Set(rawEvidence.map((item) => item.source).filter(isDetectorSource))].sort(),
      expectedCandidateSources: [...expected].sort(),
      detectedCandidateSources: [...detected].sort()
    });

    for (const source of expected) {
      counts[source].expected += 1;
      if (detected.has(source)) counts[source].detected += 1;
      else counts[source].missed += 1;
    }
    for (const source of detected) {
      if (!expected.has(source)) counts[source].falsePositive += 1;
    }
  }

  return {
    fixtureOutcomes,
    metrics: Object.fromEntries(
      Object.entries(counts).map(([source, metrics]) => [
        source,
        {
          ...metrics,
          recall: ratio(metrics.detected, metrics.expected),
          precision: ratio(metrics.detected, metrics.detected + metrics.falsePositive)
        }
      ])
    ) as Record<DetectorSource, SourceMetrics>
  };
}

async function runRawDetector(source: DetectorSource, frames: readonly ImageData[]): Promise<TimedEvidence[]> {
  if (source === 'frame-qr-code') {
    return detectQrCue(frames[0] ?? emptyImageData(), 10);
  }

  const tracker = createProgressBarTracker();
  return frames.flatMap((frame, index) => tracker.observe(detectProgressBarCue(frame, 10 + index * 5)));
}

const transcriptSupport: readonly TimedEvidence[] = [{
  source: 'transcript',
  kind: 'ad-read-start',
  startSeconds: 8,
  confidence: 0.82,
  reason: 'Benchmark-only corroborating sponsor transcript cue.'
}];

const CORPUS: readonly DetectorFixture[] = [
  {
    id: 'qr-sponsor-landscape-clean',
    source: 'frame-qr-code',
    frameFiles: ['qr-sponsor-landscape-clean.png'],
    expectedCandidateSources: ['frame-qr-code'],
    expectedRawDetection: true,
    notes: 'Self-authored 16:9 studio composite; clean sponsor-semantic QR at upper right; no third-party pixels.'
  },
  {
    id: 'qr-sponsor-small-compressed-low-contrast',
    source: 'frame-qr-code',
    frameFiles: ['qr-sponsor-small-compressed-low-contrast.png'],
    expectedCandidateSources: ['frame-qr-code'],
    expectedRawDetection: true,
    notes: 'Self-authored 16:9 composite; 2px modules, low contrast, deterministic block quantization and corner placement.'
  },
  {
    id: 'qr-sponsor-portrait-layout',
    source: 'frame-qr-code',
    frameFiles: ['qr-sponsor-portrait-layout.png'],
    expectedCandidateSources: ['frame-qr-code'],
    expectedRawDetection: true,
    notes: 'Self-authored 9:16 portrait composite with bottom-left QR placement to exercise aspect and layout.'
  },
  {
    id: 'qr-sponsor-blur-partial-occlusion',
    source: 'frame-qr-code',
    frameFiles: ['qr-sponsor-blur-partial-occlusion.png'],
    expectedCandidateSources: ['frame-qr-code'],
    expectedRawDetection: true,
    notes: 'Self-authored 16:9 composite; 3x3 box blur plus a 9px center occlusion over a 4px-module QR.'
  },
  {
    id: 'qr-generic-url-non-promotional',
    source: 'frame-qr-code',
    frameFiles: ['qr-generic-url-non-promotional.png'],
    expectedCandidateSources: [],
    expectedRawDetection: true,
    notes: 'Self-authored ordinary generic-URL QR composite; decoding is expected, but a standalone sponsor candidate is forbidden.'
  },
  {
    id: 'qr-hard-negative-noisy-geometry',
    source: 'frame-qr-code',
    frameFiles: ['qr-hard-negative-noisy-geometry.png'],
    expectedCandidateSources: [],
    expectedRawDetection: false,
    notes: 'Self-authored noisy studio composite with QR-like high-contrast rectangles and no encoded QR.'
  },
  {
    id: 'progress-advancing-landscape',
    source: 'frame-progress-bar',
    frameFiles: ['progress-advancing-landscape-1.png', 'progress-advancing-landscape-2.png', 'progress-advancing-landscape-3.png'],
    supportingEvidence: transcriptSupport,
    expectedCandidateSources: ['frame-progress-bar'],
    expectedRawDetection: true,
    notes: 'Self-authored 16:9 composite with an advancing three-row fill and a dim continuation track; transcript corroborated.'
  },
  {
    id: 'progress-countdown-compressed',
    source: 'frame-progress-bar',
    frameFiles: ['progress-countdown-compressed-1.png', 'progress-countdown-compressed-2.png', 'progress-countdown-compressed-3.png'],
    supportingEvidence: transcriptSupport,
    expectedCandidateSources: ['frame-progress-bar'],
    expectedRawDetection: true,
    notes: 'Self-authored countdown sequence with decreasing fill and deterministic block quantization; transcript corroborated.'
  },
  {
    id: 'progress-portrait-layout',
    source: 'frame-progress-bar',
    frameFiles: ['progress-portrait-layout-1.png', 'progress-portrait-layout-2.png', 'progress-portrait-layout-3.png'],
    supportingEvidence: transcriptSupport,
    expectedCandidateSources: ['frame-progress-bar'],
    expectedRawDetection: true,
    notes: 'Self-authored 9:16 composite with an advancing center-frame track; transcript corroborated.'
  },
  {
    id: 'progress-hard-negative-static-separator',
    source: 'frame-progress-bar',
    frameFiles: ['progress-hard-negative-static-separator-1.png', 'progress-hard-negative-static-separator-2.png', 'progress-hard-negative-static-separator-3.png'],
    expectedCandidateSources: [],
    expectedRawDetection: false,
    notes: 'Self-authored static bright separator without a dim continuation track.'
  },
  {
    id: 'progress-hard-negative-youtube-controls',
    source: 'frame-progress-bar',
    frameFiles: ['progress-hard-negative-youtube-controls-1.png', 'progress-hard-negative-youtube-controls-2.png', 'progress-hard-negative-youtube-controls-3.png'],
    expectedCandidateSources: [],
    expectedRawDetection: false,
    notes: 'Self-authored YouTube-like moving playback controls in the detector exclusion zone; no YouTube artwork used.'
  },
  {
    id: 'progress-hard-negative-moving-meter',
    source: 'frame-progress-bar',
    frameFiles: ['progress-hard-negative-moving-meter-1.png', 'progress-hard-negative-moving-meter-2.png', 'progress-hard-negative-moving-meter-3.png'],
    expectedCandidateSources: [],
    expectedRawDetection: true,
    notes: 'Self-authored moving audio-meter UI deliberately shaped like detector output; fusion must require corroboration.'
  }
];

function createEmptyCounts(): Record<DetectorSource, Omit<SourceMetrics, 'recall' | 'precision'>> {
  return {
    'frame-progress-bar': { expected: 0, detected: 0, missed: 0, falsePositive: 0 },
    'frame-qr-code': { expected: 0, detected: 0, missed: 0, falsePositive: 0 }
  };
}

function isDetectorSource(source: EvidenceSource): source is DetectorSource {
  return source === 'frame-progress-bar' || source === 'frame-qr-code';
}

function ratio(numerator: number, denominator: number): number {
  if (denominator === 0) return 1;
  return Number((numerator / denominator).toFixed(3));
}

function emptyImageData(): ImageData {
  return { data: new Uint8ClampedArray(4), width: 1, height: 1, colorSpace: 'srgb' } as ImageData;
}

function formatBenchmarkReport(results: DetectorBenchmarkResult): string {
  const metrics = Object.entries(results.metrics)
    .map(([source, value]) => `${source}: recall=${value.recall}, precision=${value.precision}, expected=${value.expected}, detected=${value.detected}, missed=${value.missed}, falsePositive=${value.falsePositive}`)
    .join('\n');
  const outcomes = results.fixtureOutcomes
    .map((outcome) => `${outcome.id}: raw=[${outcome.rawDetectedSources.join(',')}], expected-candidate=[${outcome.expectedCandidateSources.join(',')}], detected-candidate=[${outcome.detectedCandidateSources.join(',')}]`)
    .join('\n');
  return `Detector benchmark report\n${metrics}\n${outcomes}`;
}
