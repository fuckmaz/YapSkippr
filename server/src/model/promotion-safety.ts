import type { CandidateModelArtifact } from './types.js';

export const MIN_PROMOTION_CALIBRATION_EXAMPLES = 20;
export const MIN_PROMOTION_CALIBRATION_CLASS_EXAMPLES = 5;
export const MIN_PROMOTION_CALIBRATION_GROUPS = 5;
export const MIN_PROMOTION_POSITIVE_PRECISION = 0.9;
export const MIN_PROMOTION_POSITIVE_RECALL = 0.5;
export const MIN_PROMOTION_REVIEW_RECALL = 0.9;
export const MIN_PROMOTION_AUC = 0.7;

export interface ModelPromotionSafety {
  safe: boolean;
  blockers: string[];
}

export function evaluateModelPromotionSafety(
  candidate: CandidateModelArtifact,
  promoted: CandidateModelArtifact | null
): ModelPromotionSafety {
  const blockers: string[] = [];
  const metrics = candidate.metrics;
  const positiveThreshold = candidate.thresholds.positive;
  const reviewThreshold = candidate.thresholds.review;

  if (
    !isProbability(positiveThreshold)
    || !isProbability(reviewThreshold)
    || (reviewThreshold as number) > (positiveThreshold as number)
  ) {
    blockers.push('Candidate thresholds are missing, invalid, or inverted.');
  }
  if (metrics.thresholdsCalibrated !== 1) {
    blockers.push('Decision thresholds were not calibrated on a holdout containing both positive and negative examples.');
  }
  requireMinimum(
    blockers,
    metrics.thresholdCalibrationExamples,
    MIN_PROMOTION_CALIBRATION_EXAMPLES,
    'Holdout calibration examples'
  );
  requireMinimum(
    blockers,
    metrics.thresholdCalibrationPositives,
    MIN_PROMOTION_CALIBRATION_CLASS_EXAMPLES,
    'Holdout positive examples'
  );
  requireMinimum(
    blockers,
    metrics.thresholdCalibrationNegatives,
    MIN_PROMOTION_CALIBRATION_CLASS_EXAMPLES,
    'Holdout negative examples'
  );
  requireMinimum(
    blockers,
    metrics.thresholdCalibrationGroups,
    MIN_PROMOTION_CALIBRATION_GROUPS,
    'Holdout video groups'
  );
  requireMinimum(blockers, metrics.positivePrecision, MIN_PROMOTION_POSITIVE_PRECISION, 'Display precision');
  requireMinimum(blockers, metrics.positiveRecall, MIN_PROMOTION_POSITIVE_RECALL, 'Display recall');
  requireMinimum(blockers, metrics.reviewRecall, MIN_PROMOTION_REVIEW_RECALL, 'Review recall');
  requireMinimum(blockers, metrics.auc, MIN_PROMOTION_AUC, 'AUC');

  if (promoted) {
    requireNoRegression(blockers, 'Display precision', metrics.positivePrecision, promoted.metrics.positivePrecision, 0.02);
    requireNoRegression(blockers, 'Display recall', metrics.positiveRecall, promoted.metrics.positiveRecall, 0.05);
    requireNoRegression(blockers, 'Review recall', metrics.reviewRecall, promoted.metrics.reviewRecall, 0.05);
    requireNoRegression(blockers, 'AUC', metrics.auc, promoted.metrics.auc, 0.03);
  }

  return { safe: blockers.length === 0, blockers };
}

function requireMinimum(blockers: string[], value: number | undefined, minimum: number, label: string): void {
  if (!Number.isFinite(value) || (value as number) < minimum) {
    blockers.push(`${label} must be at least ${formatMetric(minimum)}; received ${formatMetric(value)}.`);
  }
}

function requireNoRegression(
  blockers: string[],
  label: string,
  candidate: number | undefined,
  baseline: number | undefined,
  tolerance: number
): void {
  if (!Number.isFinite(candidate) || !Number.isFinite(baseline)) return;
  if ((candidate as number) + tolerance < (baseline as number)) {
    blockers.push(
      `${label} regresses more than ${formatMetric(tolerance)} from the promoted model `
      + `(${formatMetric(candidate)} vs ${formatMetric(baseline)}).`
    );
  }
}

function isProbability(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

function formatMetric(value: number | undefined): string {
  return Number.isFinite(value) ? (value as number).toFixed(3) : 'missing';
}
