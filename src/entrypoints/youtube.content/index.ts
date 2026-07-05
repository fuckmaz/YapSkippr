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
import { createIdleScanStatus, mergeScanStatus, type ScanStatusPatch, type ScanStatusPhase } from '../../core/scan-status';
import { writeStoredScanStatus } from '../../core/scan-status-storage';
import type { TimedEvidence } from '../../core/types';
import { createYouTubeAdapter } from '../../platform/youtube/youtube-adapter';
import { observeLocationChanges } from '../../platform/youtube/route-observer';
import { formatCandidateSummary } from '../../ui/candidate-summary';
import { createLogger } from '../../ui/logger';

const logger = createLogger('youtube-content');

export default defineContentScript({
  matches: ['https://youtube.com/*', 'https://www.youtube.com/*', 'https://*.youtube.com/*', 'https://youtu.be/*'],
  cssInjectionMode: 'ui',
  async main(ctx) {
    logger.info('content script loaded');
    let stopCurrentScan: (() => void) | undefined;

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
    });
  }
});

async function startDetectionOnlyScan(adapter: ReturnType<typeof createYouTubeAdapter>): Promise<() => void> {
  const statusUi = await adapter.mountStatusUi();
  const evidence: TimedEvidence[] = [];
  let stopped = false;
  let sampleCount = 0;
  let stopFrames: (() => void) | undefined;
  let scanStatus = mergeScanStatus(createIdleScanStatus(), {
    platformId: adapter.id,
    videoId: adapter.getVideoId(),
    pageUrl: location.href,
    phase: 'starting',
    message: 'Starting YapSkippr scan...'
  });

  function publishScanStatus(patch: ScanStatusPatch): void {
    scanStatus = mergeScanStatus(scanStatus, patch);
    void writeStoredScanStatus(scanStatus).catch((error: unknown) => {
      logger.warn('popup status update failed', error);
    });
  }

  function setScanProgress(
    message: string,
    progress: number,
    phase: ScanStatusPhase,
    patch: ScanStatusPatch = {}
  ): void {
    statusUi.setStatus(message);
    statusUi.setProgress(progress);
    publishScanStatus({ ...patch, message, progress, phase });
  }

  function publishCandidates(candidates: ReturnType<typeof buildSegmentCandidates>): void {
    publishScanStatus({
      candidateCount: candidates.length,
      candidates: candidates.slice(0, 5).map((candidate) => formatCandidateSummary(candidate))
    });
  }

  setScanProgress('Finding YouTube video...', 0.05, 'starting');

  const video = await waitForVideo(adapter);
  if (!video || stopped) {
    setScanProgress('No playable video found.', 1, 'error');
    return () => statusUi.destroy();
  }

  setScanProgress('Loading transcript cues...', 0.2, 'transcript');

  void adapter
    .loadTranscript()
    .then((cues) => {
      if (stopped) return;
      const transcriptEvidence = analyzeTranscriptCues(cues);
      evidence.push(...transcriptEvidence);
      logger.info('transcript analyzed', { cues: cues.length, evidence: transcriptEvidence.length });
      publishCandidates(updateCandidates(evidence, statusUi));
      setScanProgress('Analyzing visible video frames...', 0.35, 'frames');
    })
    .catch((error: unknown) => {
      logger.warn('transcript unavailable', error);
      setScanProgress('Transcript unavailable; analyzing frames...', 0.3, 'frames');
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
      }

      setScanProgress(`Analyzing frames... ${sampleCount} sampled`, Math.min(0.95, 0.35 + sampleCount / 40), 'frames', {
        sampleCount
      });
    },
    onError(error) {
      if (isExtensionContextInvalidatedError(error)) {
        logger.warn('frame sampling stopped because extension context was invalidated', error.message);
        setScanProgress('Extension reloaded. Reload this YouTube tab to resume frame analysis.', scanStatus.progress, 'error');
        stopFrames?.();
        return;
      }
      if (isCapturePermissionMissingError(error)) {
        logger.warn('frame sampling stopped because capture permission is missing', error.message);
        setScanProgress(
          'Frame capture permission missing. Click the YapSkippr extension icon, grant access, then reload this tab.',
          scanStatus.progress,
          'permission'
        );
        stopFrames?.();
        return;
      }
      logger.warn('frame sampling failed', error.message);
      setScanProgress('Frame capture unavailable; transcript scan continues.', scanStatus.progress, 'error');
    }
  });

  return () => {
    stopped = true;
    stopFrames?.();
    publishScanStatus({ phase: 'stopped', message: 'Scan stopped.' });
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
