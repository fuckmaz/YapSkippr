import { buildSegmentCandidates } from '../analysis/evidence-fusion';
import {
  analyzeTranscriptCues,
  type TranscriptPhraseGroup
} from '../analysis/transcript-analyzer';
import type { SegmentCandidate, TimedEvidence, TranscriptCue } from '../types';

export interface ExpectedSegment {
  startSeconds: number;
  endSeconds: number;
}

export interface SegmentBenchmarkCase {
  id: string;
  title: string;
  durationSeconds: number;
  transcriptCues: readonly TranscriptCue[];
  supportingEvidence?: readonly TimedEvidence[];
  expectedSegments: readonly ExpectedSegment[];
  phraseGroups?: readonly TranscriptPhraseGroup[];
  tags: readonly string[];
  provenance: string;
}

export interface SegmentBenchmarkOptions {
  minimumIntersectionOverUnion?: number;
  openEndedStartToleranceSeconds?: number;
}

export interface SegmentBenchmarkThresholds {
  minimumPrecision: number;
  minimumRecall: number;
  minimumNegativeCaseAccuracy: number;
  minimumClosedBoundaryRate: number;
  maximumFalsePositivesPerHour: number;
  maximumBoundaryMaeSeconds: number;
}

export interface SegmentBenchmarkMatch {
  expectedIndex: number;
  detectedIndex: number;
  intersectionOverUnion: number;
  startErrorSeconds: number;
  endErrorSeconds: number | null;
}

export interface SegmentBenchmarkCaseOutcome {
  id: string;
  title: string;
  expectedSegments: readonly ExpectedSegment[];
  detectedSegments: readonly SegmentCandidate[];
  matches: readonly SegmentBenchmarkMatch[];
  misses: number;
  falsePositives: number;
}

export interface SegmentBenchmarkMetrics {
  cases: number;
  positiveCases: number;
  negativeCases: number;
  expectedSegments: number;
  detectedSegments: number;
  matchedSegments: number;
  misses: number;
  falsePositives: number;
  precision: number;
  recall: number;
  f1: number;
  negativeCaseAccuracy: number;
  falsePositivesPerHour: number;
  closedBoundaryRate: number;
  startMaeSeconds: number | null;
  endMaeSeconds: number | null;
  boundaryMaeSeconds: number | null;
}

export interface SegmentBenchmarkResult {
  metrics: SegmentBenchmarkMetrics;
  outcomes: readonly SegmentBenchmarkCaseOutcome[];
}

interface ResolvedBenchmarkOptions {
  minimumIntersectionOverUnion: number;
  openEndedStartToleranceSeconds: number;
}

interface MatchCandidate extends SegmentBenchmarkMatch {
  score: number;
}

const DEFAULT_OPTIONS: ResolvedBenchmarkOptions = {
  minimumIntersectionOverUnion: 0.3,
  openEndedStartToleranceSeconds: 12
};

export function runHeuristicSegmentBenchmark(
  cases: readonly SegmentBenchmarkCase[],
  options: SegmentBenchmarkOptions = {}
): SegmentBenchmarkResult {
  const resolvedOptions = resolveOptions(options);
  const outcomes = cases.map((benchmarkCase) => {
    validateBenchmarkCase(benchmarkCase);
    const transcriptEvidence = analyzeTranscriptCues(
      [...benchmarkCase.transcriptCues],
      benchmarkCase.phraseGroups ? { phraseGroups: benchmarkCase.phraseGroups } : {}
    );
    const detectedSegments = buildSegmentCandidates([
      ...transcriptEvidence,
      ...(benchmarkCase.supportingEvidence ?? [])
    ]);
    const matches = matchSegments(benchmarkCase.expectedSegments, detectedSegments, resolvedOptions);

    return {
      id: benchmarkCase.id,
      title: benchmarkCase.title,
      expectedSegments: benchmarkCase.expectedSegments,
      detectedSegments,
      matches,
      misses: benchmarkCase.expectedSegments.length - matches.length,
      falsePositives: detectedSegments.length - matches.length
    };
  });

  return {
    outcomes,
    metrics: calculateMetrics(cases, outcomes)
  };
}

export function evaluateSegmentBenchmarkThresholds(
  result: SegmentBenchmarkResult,
  thresholds: SegmentBenchmarkThresholds
): string[] {
  const failures: string[] = [];
  const { metrics } = result;

  checkMinimum(failures, 'precision', metrics.precision, thresholds.minimumPrecision);
  checkMinimum(failures, 'recall', metrics.recall, thresholds.minimumRecall);
  checkMinimum(
    failures,
    'negative-case accuracy',
    metrics.negativeCaseAccuracy,
    thresholds.minimumNegativeCaseAccuracy
  );
  checkMinimum(
    failures,
    'closed-boundary rate',
    metrics.closedBoundaryRate,
    thresholds.minimumClosedBoundaryRate
  );
  checkMaximum(
    failures,
    'false positives per hour',
    metrics.falsePositivesPerHour,
    thresholds.maximumFalsePositivesPerHour
  );

  if (metrics.boundaryMaeSeconds === null) {
    failures.push('boundary MAE is unavailable because no closed segment matched');
  } else {
    checkMaximum(
      failures,
      'boundary MAE',
      metrics.boundaryMaeSeconds,
      thresholds.maximumBoundaryMaeSeconds,
      's'
    );
  }

  return failures;
}

export function formatSegmentBenchmarkReport(result: SegmentBenchmarkResult): string {
  const { metrics } = result;
  const summary = [
    'Segment detection benchmark',
    `${metrics.cases} cases · ${metrics.expectedSegments} expected · ${metrics.detectedSegments} detected`,
    `precision ${formatPercent(metrics.precision)} · recall ${formatPercent(metrics.recall)} · F1 ${formatPercent(metrics.f1)}`,
    `negative accuracy ${formatPercent(metrics.negativeCaseAccuracy)} · false positives/hour ${formatNumber(metrics.falsePositivesPerHour)}`,
    `closed boundaries ${formatPercent(metrics.closedBoundaryRate)} · boundary MAE ${formatSeconds(metrics.boundaryMaeSeconds)}`
  ];
  const cases = result.outcomes.map((outcome) => {
    const passed = outcome.misses === 0 && outcome.falsePositives === 0;
    return `${passed ? 'PASS' : 'FAIL'} ${outcome.id}: expected ${outcome.expectedSegments.length}, detected ${outcome.detectedSegments.length}, matched ${outcome.matches.length}`;
  });

  return [...summary, '', ...cases].join('\n');
}

function matchSegments(
  expectedSegments: readonly ExpectedSegment[],
  detectedSegments: readonly SegmentCandidate[],
  options: ResolvedBenchmarkOptions
): SegmentBenchmarkMatch[] {
  const candidates: MatchCandidate[] = [];

  for (const [expectedIndex, expected] of expectedSegments.entries()) {
    for (const [detectedIndex, detected] of detectedSegments.entries()) {
      const startErrorSeconds = Math.abs(detected.startSeconds - expected.startSeconds);
      const endErrorSeconds = detected.endSeconds === undefined
        ? null
        : Math.abs(detected.endSeconds - expected.endSeconds);
      const intersectionOverUnion = detected.endSeconds === undefined
        ? 0
        : segmentIntersectionOverUnion(expected, {
          startSeconds: detected.startSeconds,
          endSeconds: detected.endSeconds
        });
      const isEligible = detected.endSeconds === undefined
        ? startErrorSeconds <= options.openEndedStartToleranceSeconds
        : intersectionOverUnion >= options.minimumIntersectionOverUnion;
      if (!isEligible) continue;

      candidates.push({
        expectedIndex,
        detectedIndex,
        intersectionOverUnion,
        startErrorSeconds,
        endErrorSeconds,
        score: detected.endSeconds === undefined
          ? 0.1 * (1 - startErrorSeconds / Math.max(1, options.openEndedStartToleranceSeconds))
          : intersectionOverUnion
      });
    }
  }

  candidates.sort((left, right) => {
    return right.score - left.score
      || left.startErrorSeconds - right.startErrorSeconds
      || (left.endErrorSeconds ?? Number.POSITIVE_INFINITY) - (right.endErrorSeconds ?? Number.POSITIVE_INFINITY)
      || left.expectedIndex - right.expectedIndex
      || left.detectedIndex - right.detectedIndex;
  });

  const matchedExpected = new Set<number>();
  const matchedDetected = new Set<number>();
  const matches: SegmentBenchmarkMatch[] = [];

  for (const candidate of candidates) {
    if (matchedExpected.has(candidate.expectedIndex) || matchedDetected.has(candidate.detectedIndex)) continue;
    matchedExpected.add(candidate.expectedIndex);
    matchedDetected.add(candidate.detectedIndex);
    matches.push({
      expectedIndex: candidate.expectedIndex,
      detectedIndex: candidate.detectedIndex,
      intersectionOverUnion: round(candidate.intersectionOverUnion),
      startErrorSeconds: round(candidate.startErrorSeconds),
      endErrorSeconds: candidate.endErrorSeconds === null ? null : round(candidate.endErrorSeconds)
    });
  }

  return matches.sort((left, right) => left.expectedIndex - right.expectedIndex);
}

function calculateMetrics(
  cases: readonly SegmentBenchmarkCase[],
  outcomes: readonly SegmentBenchmarkCaseOutcome[]
): SegmentBenchmarkMetrics {
  const expectedSegments = sum(outcomes.map((outcome) => outcome.expectedSegments.length));
  const detectedSegments = sum(outcomes.map((outcome) => outcome.detectedSegments.length));
  const matchedSegments = sum(outcomes.map((outcome) => outcome.matches.length));
  const misses = expectedSegments - matchedSegments;
  const falsePositives = detectedSegments - matchedSegments;
  const precision = ratio(matchedSegments, detectedSegments);
  const recall = ratio(matchedSegments, expectedSegments);
  const negativeOutcomes = outcomes.filter((outcome) => outcome.expectedSegments.length === 0);
  const cleanNegativeCases = negativeOutcomes.filter((outcome) => outcome.detectedSegments.length === 0).length;
  const matches = outcomes.flatMap((outcome) => outcome.matches);
  const closedMatches = matches.filter((match) => match.endErrorSeconds !== null);
  const startErrors = matches.map((match) => match.startErrorSeconds);
  const endErrors = closedMatches.map((match) => match.endErrorSeconds as number);
  const boundaryErrors = closedMatches.flatMap((match) => [
    match.startErrorSeconds,
    match.endErrorSeconds as number
  ]);
  const totalDurationSeconds = sum(cases.map((benchmarkCase) => benchmarkCase.durationSeconds));

  return {
    cases: cases.length,
    positiveCases: cases.length - negativeOutcomes.length,
    negativeCases: negativeOutcomes.length,
    expectedSegments,
    detectedSegments,
    matchedSegments,
    misses,
    falsePositives,
    precision: round(precision),
    recall: round(recall),
    f1: round(precision + recall === 0 ? 0 : 2 * precision * recall / (precision + recall)),
    negativeCaseAccuracy: round(ratio(cleanNegativeCases, negativeOutcomes.length)),
    falsePositivesPerHour: round(totalDurationSeconds === 0 ? 0 : falsePositives * 3600 / totalDurationSeconds),
    closedBoundaryRate: round(ratio(closedMatches.length, matchedSegments)),
    startMaeSeconds: mean(startErrors),
    endMaeSeconds: mean(endErrors),
    boundaryMaeSeconds: mean(boundaryErrors)
  };
}

function validateBenchmarkCase(benchmarkCase: SegmentBenchmarkCase): void {
  if (!benchmarkCase.id.trim()) throw new Error('Segment benchmark case id must not be empty.');
  if (!Number.isFinite(benchmarkCase.durationSeconds) || benchmarkCase.durationSeconds <= 0) {
    throw new Error(`Segment benchmark case "${benchmarkCase.id}" needs a positive duration.`);
  }

  for (const segment of benchmarkCase.expectedSegments) {
    if (
      !Number.isFinite(segment.startSeconds)
      || !Number.isFinite(segment.endSeconds)
      || segment.startSeconds < 0
      || segment.endSeconds <= segment.startSeconds
      || segment.endSeconds > benchmarkCase.durationSeconds
    ) {
      throw new Error(`Segment benchmark case "${benchmarkCase.id}" contains an invalid expected segment.`);
    }
  }
}

function resolveOptions(options: SegmentBenchmarkOptions): ResolvedBenchmarkOptions {
  const resolved = {
    minimumIntersectionOverUnion: options.minimumIntersectionOverUnion
      ?? DEFAULT_OPTIONS.minimumIntersectionOverUnion,
    openEndedStartToleranceSeconds: options.openEndedStartToleranceSeconds
      ?? DEFAULT_OPTIONS.openEndedStartToleranceSeconds
  };
  if (
    resolved.minimumIntersectionOverUnion <= 0
    || resolved.minimumIntersectionOverUnion > 1
    || resolved.openEndedStartToleranceSeconds < 0
  ) {
    throw new Error('Invalid segment benchmark matching options.');
  }
  return resolved;
}

function segmentIntersectionOverUnion(left: ExpectedSegment, right: ExpectedSegment): number {
  const intersection = Math.max(
    0,
    Math.min(left.endSeconds, right.endSeconds) - Math.max(left.startSeconds, right.startSeconds)
  );
  const union = Math.max(left.endSeconds, right.endSeconds) - Math.min(left.startSeconds, right.startSeconds);
  return union <= 0 ? 0 : intersection / union;
}

function checkMinimum(
  failures: string[],
  label: string,
  actual: number,
  minimum: number
): void {
  if (actual < minimum) failures.push(`${label} ${formatNumber(actual)} is below ${formatNumber(minimum)}`);
}

function checkMaximum(
  failures: string[],
  label: string,
  actual: number,
  maximum: number,
  suffix = ''
): void {
  if (actual > maximum) {
    failures.push(`${label} ${formatNumber(actual)}${suffix} exceeds ${formatNumber(maximum)}${suffix}`);
  }
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 1 : numerator / denominator;
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function mean(values: readonly number[]): number | null {
  return values.length === 0 ? null : round(sum(values) / values.length);
}

function round(value: number): number {
  return Number(value.toFixed(4));
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function formatSeconds(value: number | null): string {
  return value === null ? 'n/a' : `${formatNumber(value)}s`;
}
