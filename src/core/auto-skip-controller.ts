import type { SegmentCandidate } from './types';

export const AUTO_SKIP_MIN_CONFIDENCE = 0.72;
export const AUTO_SKIP_MIN_SEGMENT_SECONDS = 3;
export const AUTO_SKIP_MAX_SEGMENT_SECONDS = 240;
export const AUTO_SKIP_MIN_REMAINING_SECONDS = 1.25;
export const AUTO_SKIP_EXIT_PADDING_SECONDS = 0.15;

export interface AutoSkipPlaybackState {
  currentTimeSeconds: number;
  durationSeconds: number | null;
  isPlaying: boolean;
}

export interface AutoSkipDecision {
  id: string;
  candidateStartSeconds: number;
  candidateEndSeconds: number;
  confidence: number;
  fromSeconds: number;
  toSeconds: number;
  skippedSeconds: number;
}

export interface AutoSkipUndo {
  decision: AutoSkipDecision;
  targetSeconds: number;
}

export interface AutoSkipController {
  setEnabled(enabled: boolean): void;
  isEnabled(): boolean;
  updateCandidates(candidates: readonly SegmentCandidate[]): void;
  evaluate(playback: AutoSkipPlaybackState): AutoSkipDecision | null;
  undoLast(): AutoSkipUndo | null;
  clearLastDecision(): void;
  resetSession(): void;
}

interface HandledRange {
  startSeconds: number;
  endSeconds: number;
}

/**
 * Makes conservative, session-local auto-skip decisions. A candidate must be
 * bounded by a real detected end cue; inferred/default end times are never
 * auto-skipped. Handled ranges remain suppressed after Undo so seeking back
 * into a segment always behaves like an explicit user choice.
 */
export function createAutoSkipController(options: {
  enabled?: boolean;
  minConfidence?: number;
  exitPaddingSeconds?: number;
} = {}): AutoSkipController {
  const minConfidence = clampProbability(options.minConfidence ?? AUTO_SKIP_MIN_CONFIDENCE);
  const exitPaddingSeconds = finiteNonNegative(options.exitPaddingSeconds, AUTO_SKIP_EXIT_PADDING_SECONDS);
  let enabled = options.enabled === true;
  let candidates: SegmentCandidate[] = [];
  let handledRanges: HandledRange[] = [];
  let lastDecision: AutoSkipDecision | null = null;

  return {
    setEnabled(nextEnabled) {
      enabled = nextEnabled;
      if (!enabled) lastDecision = null;
    },

    isEnabled() {
      return enabled;
    },

    updateCandidates(nextCandidates) {
      candidates = [...nextCandidates].sort((left, right) => left.startSeconds - right.startSeconds);
    },

    evaluate(playback) {
      if (!enabled || !playback.isPlaying || !Number.isFinite(playback.currentTimeSeconds)) return null;
      const currentTimeSeconds = Math.max(0, playback.currentTimeSeconds);

      for (const candidate of candidates) {
        const range = eligibleCandidateRange(candidate, minConfidence);
        if (!range) continue;
        if (currentTimeSeconds < range.startSeconds || currentTimeSeconds >= range.endSeconds) continue;
        if (wasRangeHandled(range, handledRanges)) continue;

        const unclampedTarget = range.endSeconds + exitPaddingSeconds;
        const toSeconds = playback.durationSeconds !== null && Number.isFinite(playback.durationSeconds)
          ? Math.min(Math.max(0, playback.durationSeconds), unclampedTarget)
          : unclampedTarget;
        const skippedSeconds = toSeconds - currentTimeSeconds;
        if (skippedSeconds < AUTO_SKIP_MIN_REMAINING_SECONDS) continue;

        const decision: AutoSkipDecision = {
          id: createDecisionId(range.startSeconds, range.endSeconds),
          candidateStartSeconds: range.startSeconds,
          candidateEndSeconds: range.endSeconds,
          confidence: candidate.confidence,
          fromSeconds: currentTimeSeconds,
          toSeconds,
          skippedSeconds
        };
        handledRanges.push(range);
        lastDecision = decision;
        return decision;
      }

      return null;
    },

    undoLast() {
      if (!lastDecision) return null;
      const decision = lastDecision;
      lastDecision = null;
      return { decision, targetSeconds: decision.fromSeconds };
    },

    clearLastDecision() {
      lastDecision = null;
    },

    resetSession() {
      candidates = [];
      handledRanges = [];
      lastDecision = null;
    }
  };
}

function eligibleCandidateRange(
  candidate: SegmentCandidate,
  minConfidence: number
): HandledRange | null {
  const startSeconds = candidate.startSeconds;
  const endSeconds = candidate.endSeconds;
  if (
    !Number.isFinite(startSeconds)
    || startSeconds < 0
    || endSeconds === undefined
    || !Number.isFinite(endSeconds)
    || endSeconds <= startSeconds
    || !Number.isFinite(candidate.confidence)
    || candidate.confidence < minConfidence
  ) {
    return null;
  }

  const segmentSeconds = endSeconds - startSeconds;
  if (segmentSeconds < AUTO_SKIP_MIN_SEGMENT_SECONDS || segmentSeconds > AUTO_SKIP_MAX_SEGMENT_SECONDS) return null;

  const hasDetectedEndBoundary = candidate.evidence.some((item) => (
    item.kind === 'ad-read-end'
    && Math.abs(item.startSeconds - endSeconds) <= 10
  ));
  if (!hasDetectedEndBoundary) return null;

  return { startSeconds, endSeconds };
}

function wasRangeHandled(candidate: HandledRange, handledRanges: readonly HandledRange[]): boolean {
  return handledRanges.some((handled) => (
    candidate.startSeconds < handled.endSeconds
    && candidate.endSeconds > handled.startSeconds
  ));
}

function createDecisionId(startSeconds: number, endSeconds: number): string {
  return `${startSeconds.toFixed(1)}-${endSeconds.toFixed(1)}`;
}

function clampProbability(value: number): number {
  if (!Number.isFinite(value)) return AUTO_SKIP_MIN_CONFIDENCE;
  return Math.min(1, Math.max(0, value));
}

function finiteNonNegative(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value >= 0 ? value : fallback;
}
