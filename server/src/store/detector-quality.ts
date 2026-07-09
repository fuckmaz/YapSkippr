import type { DetectorQualityRow, FeedbackRecord } from './types.js';

export function buildDetectorQuality(items: readonly FeedbackRecord[]): DetectorQualityRow[] {
  const rows = new Map<string, DetectorQualityRow>();

  for (const item of items) {
    const source = item.payload.source ?? item.payload.occurrenceType;
    const row = rows.get(source) ?? createDetectorQualityRow(source);
    row.total += 1;

    if (!item.review) {
      row.pending += 1;
      rows.set(source, row);
      continue;
    }

    row.reviewed += 1;
    if (item.review.label === 'positive') row.positive += 1;
    else if (item.review.label === 'false_positive') row.falsePositive += 1;
    else if (item.review.label === 'wrong_timing') row.wrongTiming += 1;
    else if (item.review.label === 'duplicate') row.duplicate += 1;
    else if (item.review.label === 'ignored') row.ignored += 1;
    else if (item.review.label === 'needs_more_data') row.needsMoreData += 1;

    row.trainablePositive = row.positive;
    row.trainableNegative = row.falsePositive + row.duplicate + row.ignored;
    row.positiveRate = row.reviewed === 0 ? 0 : roundRate(row.positive / row.reviewed);
    rows.set(source, row);
  }

  return [...rows.values()].sort((a, b) => a.source.localeCompare(b.source));
}

function createDetectorQualityRow(source: string): DetectorQualityRow {
  return {
    source,
    total: 0,
    reviewed: 0,
    pending: 0,
    positive: 0,
    falsePositive: 0,
    wrongTiming: 0,
    duplicate: 0,
    ignored: 0,
    needsMoreData: 0,
    trainablePositive: 0,
    trainableNegative: 0,
    positiveRate: 0
  };
}

function roundRate(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}
