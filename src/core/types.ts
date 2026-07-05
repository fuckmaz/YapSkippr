export type EvidenceSource = 'frame-progress-bar' | 'frame-qr-code' | 'transcript';

export type EvidenceKind = 'ad-read-start' | 'ad-read-end' | 'ad-read-presence';

export interface TimedEvidence {
  source: EvidenceSource;
  kind: EvidenceKind;
  startSeconds: number;
  endSeconds?: number;
  confidence: number;
  reason: string;
  raw?: unknown;
}

export interface SegmentCandidate {
  startSeconds: number;
  endSeconds?: number;
  confidence: number;
  evidence: TimedEvidence[];
}

export interface TranscriptCue {
  startSeconds: number;
  durationSeconds: number;
  text: string;
}

export interface ScanProgress {
  phase: 'idle' | 'frames' | 'transcript' | 'fusion' | 'done' | 'error';
  message: string;
  completed: number;
  total: number;
}
