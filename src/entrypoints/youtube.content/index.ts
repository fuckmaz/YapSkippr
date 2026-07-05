import './style.css';
import { buildSegmentCandidates } from '../../core/analysis/evidence-fusion';
import { detectProgressBarCue } from '../../core/analysis/progress-bar-detector';
import { detectQrCue } from '../../core/analysis/qr-detector';
import {
  isCapturePermissionMissingError,
  isExtensionContextInvalidatedError,
  startScreenshotFrameSampler
} from '../../core/analysis/frame-sampler';
import { analyzeTranscriptCues } from '../../core/analysis/transcript-analyzer';
import {
  appendScanStatusEvent,
  createIdleScanStatus,
  createEmptyEvidenceCounts,
  mergeScanStatus,
  type ScanEvidenceCounts,
  type ScanStatusCandidate,
  type ScanStatusPatch,
  type ScanStatusPhase
} from '../../core/scan-status';
import { writeStoredScanStatus } from '../../core/scan-status-storage';
import type { EvidenceSource, SegmentCandidate, TimedEvidence } from '../../core/types';
import { createYouTubeAdapter } from '../../platform/youtube/youtube-adapter';
import { observeLocationChanges } from '../../platform/youtube/route-observer';
import { formatCandidateSummary } from '../../ui/candidate-summary';
import { createLogger } from '../../ui/logger';

const logger = createLogger('youtube-content');
const SEEK_TO_MESSAGE_TYPE = 'YAPSKIPPR_SEEK_TO';

interface SeekToRequest {
  type?: string;
  seconds?: number;
}

interface SeekToResponse {
  ok: boolean;
  currentTimeSeconds?: number;
  error?: string;
}

export default defineContentScript({
  matches: ['https://youtube.com/*', 'https://www.youtube.com/*', 'https://*.youtube.com/*', 'https://youtu.be/*'],
  cssInjectionMode: 'ui',
  async main(ctx) {
    logger.info('content script loaded');
    let stopCurrentScan: (() => void) | undefined;
    const seekListener = (
      message: SeekToRequest,
      _sender: chrome.runtime.MessageSender,
      sendResponse: (response: SeekToResponse) => void
    ): boolean => {
      if (message?.type !== SEEK_TO_MESSAGE_TYPE) return false;

      const adapter = createYouTubeAdapter();
      const video = adapter.getVideoElement();
      if (!video) {
        sendResponse({ ok: false, error: 'No playable YouTube video is available.' });
        return false;
      }

      const seconds = typeof message.seconds === 'number' && Number.isFinite(message.seconds) ? message.seconds : null;
      if (seconds === null) {
        sendResponse({ ok: false, error: 'Invalid seek time.' });
        return false;
      }

      video.currentTime = clamp(seconds, 0, Number.isFinite(video.duration) ? video.duration : seconds);
      sendResponse({ ok: true, currentTimeSeconds: video.currentTime });
      return false;
    };

    chrome.runtime.onMessage.addListener(seekListener);

    async function bootForUrl(url: URL): Promise<void> {
      stopCurrentScan?.();
      stopCurrentScan = undefined;

      const adapter = createYouTubeAdapter();
      if (!adapter.matches(url)) {
        logger.debug('url ignored', url.href);
        return;
      }

      logger.info('watch page detected', { videoId: adapter.getVideoId() });
      stopCurrentScan = await startDetectionOnlyScan(adapter);
    }

    await bootForUrl(new URL(location.href));
    const stopRoutes = observeLocationChanges((url) => void bootForUrl(url));
    ctx.addEventListener(window, 'pagehide', () => {
      stopCurrentScan?.();
      stopRoutes();
      chrome.runtime.onMessage.removeListener(seekListener);
    });
  }
});

async function startDetectionOnlyScan(adapter: ReturnType<typeof createYouTubeAdapter>): Promise<() => void> {
  const statusUi = await adapter.mountStatusUi();
  const evidence: TimedEvidence[] = [];
  let stopped = false;
  let sampleCount = 0;
  let lastCandidateCount = 0;
  let stopFrames: (() => void) | undefined;
  let scanStatus = mergeScanStatus(createIdleScanStatus(), {
    platformId: adapter.id,
    videoId: adapter.getVideoId(),
    pageUrl: location.href,
    phase: 'starting',
    message: 'Starting YapSkippr scan...'
  });

  function publishScanStatus(
    patch: ScanStatusPatch,
    event?: { level: 'info' | 'warn' | 'error'; message: string; detail?: string }
  ): void {
    scanStatus = mergeScanStatus(scanStatus, patch);
    if (event) {
      scanStatus = appendScanStatusEvent(scanStatus, {
        ...event,
        timestamp: Date.now()
      });
    }
    void writeStoredScanStatus(scanStatus).catch((error: unknown) => {
      logger.warn('popup status update failed', error);
    });
  }

  function setScanProgress(
    message: string,
    progress: number,
    phase: ScanStatusPhase,
    patch: ScanStatusPatch = {},
    event?: { level: 'info' | 'warn' | 'error'; message: string; detail?: string }
  ): void {
    statusUi.setStatus(message);
    statusUi.setProgress(progress);
    publishScanStatus({ ...patch, message, progress, phase }, event);
  }

  function publishCandidates(candidates: SegmentCandidate[]): void {
    const candidateEvent = candidates.length > 0 && candidates.length !== lastCandidateCount
      ? {
        level: 'info' as const,
        message: `${candidates.length} candidate ${candidates.length === 1 ? 'segment' : 'segments'} detected`,
        detail: candidates[0] ? formatCandidateSummary(candidates[0]) : undefined
      }
      : undefined;

    lastCandidateCount = candidates.length;
    publishScanStatus({
      candidateCount: candidates.length,
      evidenceCounts: countEvidenceSources(evidence),
      candidates: candidates.slice(0, 5).map(toScanStatusCandidate)
    }, candidateEvent);
  }

  setScanProgress('Finding YouTube video...', 0.05, 'starting', {}, { level: 'info', message: 'Scan started' });

  const video = await waitForVideo(adapter);
  if (!video || stopped) {
    setScanProgress('No playable video found.', 1, 'error', {}, { level: 'error', message: 'No playable video found' });
    return () => statusUi.destroy();
  }

  publishScanStatus({
    videoCurrentTimeSeconds: video.currentTime,
    videoDurationSeconds: getFiniteDuration(video)
  });
  setScanProgress('Loading transcript cues...', 0.2, 'transcript', {}, { level: 'info', message: 'Transcript scan started' });

  void adapter
    .loadTranscript()
    .then((cues) => {
      if (stopped) return;
      const transcriptEvidence = analyzeTranscriptCues(cues);
      evidence.push(...transcriptEvidence);
      logger.info('transcript analyzed', { cues: cues.length, evidence: transcriptEvidence.length });
      publishCandidates(updateCandidates(evidence, statusUi));
      setScanProgress(
        'Analyzing visible video frames...',
        0.35,
        'frames',
        { evidenceCounts: countEvidenceSources(evidence) },
        {
          level: 'info',
          message: 'Transcript scan finished',
          detail: `${cues.length} cues, ${transcriptEvidence.length} evidence hits`
        }
      );
    })
    .catch((error: unknown) => {
      logger.warn('transcript unavailable', error);
      setScanProgress(
        'Transcript unavailable; analyzing frames...',
        0.3,
        'frames',
        {},
        { level: 'warn', message: 'Transcript unavailable', detail: error instanceof Error ? error.message : String(error) }
      );
    });

  stopFrames = startScreenshotFrameSampler(video, {
    width: 320,
    sampleIntervalMs: 1000,
    async onFrame(frame) {
      sampleCount += 1;
      logger.debug('frame sampled', {
        time: frame.currentTimeSeconds,
        width: frame.width,
        height: frame.height
      });

      const frameEvidence = [...detectProgressBarCue(frame.imageData, frame.currentTimeSeconds)];
      if (sampleCount % 2 === 0) {
        frameEvidence.push(...(await detectQrCue(frame.imageData, frame.currentTimeSeconds)));
      }

      if (frameEvidence.length > 0) {
        evidence.push(...frameEvidence);
        logger.info('frame evidence detected', frameEvidence);
        publishCandidates(updateCandidates(evidence, statusUi));
        publishScanStatus(
          { evidenceCounts: countEvidenceSources(evidence) },
          {
            level: 'info',
            message: `${frameEvidence.length} frame ${frameEvidence.length === 1 ? 'cue' : 'cues'} found`,
            detail: summarizeEvidenceSources(frameEvidence)
          }
        );
      }

      setScanProgress(`Analyzing frames... ${sampleCount} sampled`, Math.min(0.95, 0.35 + sampleCount / 40), 'frames', {
        sampleCount,
        videoCurrentTimeSeconds: frame.currentTimeSeconds,
        videoDurationSeconds: getFiniteDuration(video),
        evidenceCounts: countEvidenceSources(evidence)
      });
    },
    onError(error) {
      if (isExtensionContextInvalidatedError(error)) {
        logger.warn('frame sampling stopped because extension context was invalidated', error.message);
        setScanProgress(
          'Extension reloaded. Reload this YouTube tab to resume frame analysis.',
          scanStatus.progress,
          'error',
          {},
          { level: 'error', message: 'Extension context invalidated' }
        );
        stopFrames?.();
        return;
      }
      if (isCapturePermissionMissingError(error)) {
        logger.warn('frame sampling stopped because capture permission is missing', error.message);
        setScanProgress(
          'Frame capture permission missing. Click the YapSkippr extension icon, grant access, then reload this tab.',
          scanStatus.progress,
          'permission',
          {},
          { level: 'warn', message: 'Frame capture permission missing', detail: error.message }
        );
        stopFrames?.();
        return;
      }
      logger.warn('frame sampling failed', error.message);
      setScanProgress(
        'Frame capture unavailable; transcript scan continues.',
        scanStatus.progress,
        'error',
        {},
        { level: 'error', message: 'Frame capture failed', detail: error.message }
      );
    }
  });

  return () => {
    stopped = true;
    stopFrames?.();
    publishScanStatus({ phase: 'stopped', message: 'Scan stopped.' }, { level: 'info', message: 'Scan stopped' });
    statusUi.destroy();
  };
}

async function waitForVideo(adapter: ReturnType<typeof createYouTubeAdapter>, timeoutMs = 10_000): Promise<HTMLVideoElement | null> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const video = adapter.getVideoElement();
    if (video && video.readyState >= HTMLMediaElement.HAVE_METADATA) return video;
    await new Promise((resolve) => window.setTimeout(resolve, 250));
  }
  return adapter.getVideoElement();
}

function updateCandidates(
  evidence: TimedEvidence[],
  statusUi: { setCandidates(candidates: ReturnType<typeof buildSegmentCandidates>): void }
): ReturnType<typeof buildSegmentCandidates> {
  const candidates = buildSegmentCandidates(evidence);
  statusUi.setCandidates(candidates);
  logger.info('segment candidates updated', candidates);
  return candidates;
}

function toScanStatusCandidate(candidate: SegmentCandidate): ScanStatusCandidate {
  return {
    id: `${Math.round(candidate.startSeconds)}-${candidate.endSeconds === undefined ? 'open' : Math.round(candidate.endSeconds)}`,
    startSeconds: candidate.startSeconds,
    ...(candidate.endSeconds === undefined ? {} : { endSeconds: candidate.endSeconds }),
    confidence: candidate.confidence,
    summary: formatCandidateSummary(candidate),
    sources: getCandidateSourceLabels(candidate)
  };
}

function countEvidenceSources(evidence: TimedEvidence[]): ScanEvidenceCounts {
  const counts = createEmptyEvidenceCounts();

  for (const item of evidence) {
    if (item.source === 'transcript') counts.transcript += 1;
    if (item.source === 'frame-progress-bar') counts.progressBar += 1;
    if (item.source === 'frame-qr-code') counts.qrCode += 1;
  }

  counts.total = counts.transcript + counts.progressBar + counts.qrCode;
  return counts;
}

function getCandidateSourceLabels(candidate: SegmentCandidate): string[] {
  return [...new Set(candidate.evidence.map((item) => formatEvidenceSource(item.source)))];
}

function summarizeEvidenceSources(evidence: TimedEvidence[]): string {
  return [...new Set(evidence.map((item) => formatEvidenceSource(item.source)))].join(' + ');
}

function formatEvidenceSource(source: EvidenceSource): string {
  if (source === 'transcript') return 'transcript';
  if (source === 'frame-qr-code') return 'QR';
  return 'progress bar';
}

function getFiniteDuration(video: HTMLVideoElement): number | null {
  return Number.isFinite(video.duration) ? video.duration : null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
