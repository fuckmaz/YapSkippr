import type { TranscriptCue } from '../core/types';

export interface VideoPlatformAdapter {
  id: string;
  matches(url: URL): boolean;
  getVideoId(): string | null;
  getVideoElement(): HTMLVideoElement | null;
  getCurrentTimeSeconds(): number;
  observeVideoChanges(onChange: () => void): () => void;
  loadTranscript(): Promise<TranscriptCue[]>;
  mountStatusUi(): Promise<StatusUiHandle>;
}

export interface StatusUiHandle {
  setStatus(message: string): void;
  setProgress(value: number): void;
  setCandidates(count: number): void;
  destroy(): void;
}
