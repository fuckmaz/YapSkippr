import type { SegmentCandidate, TranscriptCue } from '../core/types';

export interface VideoPlatformAdapter {
  id: string;
  matches(url: URL): boolean;
  getVideoId(): string | null;
  getVideoElement(): HTMLVideoElement | null;
  getCurrentTimeSeconds(): number;
  observeVideoChanges(onChange: (change: VideoElementChange) => void): () => void;
  loadTranscript(): Promise<TranscriptCue[]>;
  mountStatusUi(): Promise<StatusUiHandle>;
}

export interface VideoElementChange {
  removedNodes: readonly Node[];
}

export interface StatusUiHandle {
  setStatus(message: string): void;
  setProgress(value: number): void;
  setDetails?(details: StatusUiDetails): void;
  setCandidates(candidates: SegmentCandidate[]): void;
  showAutoSkipNotice(notice: AutoSkipNotice | null): void;
  destroy(): void;
}

export interface AutoSkipNotice {
  skippedSeconds: number;
  onUndo(): void;
}

export interface StatusUiDetails {
  phase: string;
  sampleCount: number;
  evidenceCounts: {
    transcript: number;
    progressBar: number;
    qrCode: number;
    visibleLink: number;
    total: number;
  };
  videoCurrentTimeSeconds: number | null;
  videoDurationSeconds: number | null;
}
