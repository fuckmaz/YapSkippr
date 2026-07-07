import './style.css';
import { buildSegmentCandidates } from '../../core/analysis/evidence-fusion';
import { detectProgressBarCue } from '../../core/analysis/progress-bar-detector';
import { detectQrCue } from '../../core/analysis/qr-detector';
import {
  isCapturePermissionMissingError,
  isExtensionContextInvalidatedError,
  startScreenshotFrameSampler
} from '../../core/analysis/frame-sampler';
import { detectVisibleLinkCue } from '../../core/analysis/link-detector';
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
const FAST_SCAN_MESSAGE_TYPE = 'YAPSKIPPR_SET_FAST_SCAN';
const NORMAL_SAMPLE_INTERVAL_MS = 5000;

interface SeekToRequest {
  type?: string;
  seconds?: number;
}

interface FastScanRequest {
  type?: string;
  enabled?: boolean;
  intervalSeconds?: number;
}

interface SeekToResponse {
  ok: boolean;
  currentTimeSeconds?: number;
  error?: string;
}

interface FastScanResponse {
  ok: boolean;
  enabled?: boolean;
  intervalSeconds?: number;
  error?: string;
}

interface ActiveScanControl {
  stop(): void;
  setFastScan(enabled: boolean, intervalSeconds: number): FastScanResponse;
}

export default defineContentScript({
  matches: ['https://youtube.com/*', 'https://www.youtube.com/*', 'https://*.youtube.com/*', 'https://youtu.be/*'],
  cssInjectionMode: 'ui',
  async main(ctx) {
    logger.info('content script loaded');
    let activeScan: ActiveScanControl | undefined;
    const messageListener = (
      message: SeekToRequest | FastScanRequest,
      _sender: chrome.runtime.MessageSender,
      sendResponse: (response: SeekToResponse | FastScanResponse) => void
    ): boolean => {
      if (message?.type === FAST_SCAN_MESSAGE_TYPE) {
        if (!activeScan) {
          sendResponse({ ok: false, error: 'No active YouTube scan is available.' });
          return false;
        }

        const request = message as FastScanRequest;
        sendResponse(activeScan.setFastScan(request.enabled === true, Number(request.intervalSeconds ?? 2)));
        return false;
      }

      if (message?.type !== SEEK_TO_MESSAGE_TYPE) return false;
      const request = message as SeekToRequest;

      const adapter = createYouTubeAdapter();
      const video = adapter.getVideoElement();
      if (!video) {
        sendResponse({ ok: false, error: 'No playable YouTube video is available.' });
        return false;
      }

      const seconds = typeof request.seconds === 'number' && Number.isFinite(request.seconds) ? request.seconds : null;
      if (seconds === null) {
        sendResponse({ ok: false, error: 'Invalid seek time.' });
        return false;
      }

      video.currentTime = clamp(seconds, 0, Number.isFinite(video.duration) ? video.duration : seconds);
      sendResponse({ ok: true, currentTimeSeconds: video.currentTime });
      return false;
    };

    chrome.runtime.onMessage.addListener(messageListener);

    async function bootForUrl(url: URL): Promise<void> {
      activeScan?.stop();
      activeScan = undefined;

      const adapter = createYouTubeAdapter();
      if (!adapter.matches(url)) {
        logger.debug('url ignored', url.href);
        return;
      }

      logger.info('watch page detected', { videoId: adapter.getVideoId() });
      activeScan = await startDetectionOnlyScan(adapter);
    }

    await bootForUrl(new URL(location.href));
    const stopRoutes = observeLocationChanges((url) => void bootForUrl(url));
    ctx.addEventListener(window, 'pagehide', () => {
      activeScan?.stop();
      stopRoutes();
      chrome.runtime.onMessage.removeListener(messageListener);
    });
  }
});

async function startDetectionOnlyScan(adapter: ReturnType<typeof createYouTubeAdapter>): Promise<ActiveScanControl> {
  const statusUi = await adapter.mountStatusUi();
  const evidence: TimedEvidence[] = [];
  let stopped = false;
  let sampleCount = 0;
  let lastCandidateCount = 0;
  let fastScanEnabled = false;
  let fastScanIntervalSeconds = 2;
  let stopFrames: (() => void) | undefined;
  let scanStatus = mergeScanStatus(createIdleScanStatus(), {
    platformId: adapter.id,
    videoId: adapter.getVideoId(),
    pageUrl: location.href,
    phase: 'starting',
    message: 'Starting YapSkippr scan...',
    fastScanEnabled,
    fastScanIntervalSeconds
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
    return {
      stop() {
        statusUi.destroy();
      },
      setFastScan() {
        return { ok: false, error: 'No playable YouTube video is available.' };
      }
    };
  }
  const playableVideo = video;

  publishScanStatus({
    videoCurrentTimeSeconds: playableVideo.currentTime,
    videoDurationSeconds: getFiniteDuration(playableVideo),
    fastScanEnabled,
    fastScanIntervalSeconds
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

  function restartFrameSampling(): void {
    stopFrames?.();
    stopFrames = startScreenshotFrameSampler(playableVideo, {
      width: 320,
      sampleIntervalMs: fastScanEnabled ? fastScanIntervalSeconds * 1000 : NORMAL_SAMPLE_INTERVAL_MS,
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
        frameEvidence.push(...(await detectVisibleLinkCue(frame.imageData, frame.currentTimeSeconds)));

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
          videoDurationSeconds: getFiniteDuration(playableVideo),
          fastScanEnabled,
          fastScanIntervalSeconds,
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
  }

  restartFrameSampling();

  return {
    stop() {
      stopped = true;
      stopFrames?.();
      publishScanStatus({ phase: 'stopped', message: 'Scan stopped.' }, { level: 'info', message: 'Scan stopped' });
      statusUi.destroy();
    },
    setFastScan(enabled: boolean, intervalSeconds: number): FastScanResponse {
      if (stopped) return { ok: false, error: 'Scan is already stopped.' };

      fastScanEnabled = enabled;
      fastScanIntervalSeconds = clampFastScanIntervalSeconds(intervalSeconds);
      restartFrameSampling();

      const message = fastScanEnabled
        ? `Fast pre-scan running every ${fastScanIntervalSeconds}s.`
        : 'Fast pre-scan stopped; background scan continues every 5s.';
      setScanProgress(
        message,
        scanStatus.progress,
        'frames',
        { fastScanEnabled, fastScanIntervalSeconds },
        {
          level: 'info',
          message: fastScanEnabled ? 'Fast pre-scan started' : 'Fast pre-scan stopped',
          detail: fastScanEnabled ? `${fastScanIntervalSeconds}s frame interval` : '5s frame interval'
        }
      );

      return { ok: true, enabled: fastScanEnabled, intervalSeconds: fastScanIntervalSeconds };
    }
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
    if (item.source === 'frame-visible-link') counts.visibleLink += 1;
  }

  counts.total = counts.transcript + counts.progressBar + counts.qrCode + counts.visibleLink;
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
  if (source === 'frame-visible-link') return 'visible link';
  return 'progress bar';
}

function getFiniteDuration(video: HTMLVideoElement): number | null {
  return Number.isFinite(video.duration) ? video.duration : null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clampFastScanIntervalSeconds(value: number): number {
  if (!Number.isFinite(value)) return 2;
  return Math.min(5, Math.max(1, Math.round(value)));
}
