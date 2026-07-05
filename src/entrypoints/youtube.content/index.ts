import './style.css';
import { buildSegmentCandidates } from '../../core/analysis/evidence-fusion';
import { detectProgressBarCue } from '../../core/analysis/progress-bar-detector';
import { detectQrCue } from '../../core/analysis/qr-detector';
import { startScreenshotFrameSampler } from '../../core/analysis/frame-sampler';
import { analyzeTranscriptCues } from '../../core/analysis/transcript-analyzer';
import type { TimedEvidence } from '../../core/types';
import { createYouTubeAdapter } from '../../platform/youtube/youtube-adapter';
import { observeLocationChanges } from '../../platform/youtube/route-observer';
import { createLogger } from '../../ui/logger';

const logger = createLogger('youtube-content');

export default defineContentScript({
  matches: ['https://*.youtube.com/*', 'https://youtu.be/*'],
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

  statusUi.setStatus('Finding YouTube video...');
  statusUi.setProgress(0.05);

  const video = await waitForVideo(adapter);
  if (!video || stopped) {
    statusUi.setStatus('No playable video found.');
    statusUi.setProgress(1);
    return () => statusUi.destroy();
  }

  statusUi.setStatus('Loading transcript cues...');
  statusUi.setProgress(0.2);

  void adapter
    .loadTranscript()
    .then((cues) => {
      if (stopped) return;
      const transcriptEvidence = analyzeTranscriptCues(cues);
      evidence.push(...transcriptEvidence);
      logger.info('transcript analyzed', { cues: cues.length, evidence: transcriptEvidence.length });
      updateCandidates(evidence, statusUi);
      statusUi.setStatus('Analyzing visible video frames...');
      statusUi.setProgress(0.35);
    })
    .catch((error: unknown) => {
      logger.warn('transcript unavailable', error);
      statusUi.setStatus('Transcript unavailable; analyzing frames...');
      statusUi.setProgress(0.3);
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
        updateCandidates(evidence, statusUi);
      }

      statusUi.setProgress(Math.min(0.95, 0.35 + sampleCount / 40));
      statusUi.setStatus(`Analyzing frames... ${sampleCount} sampled`);
    },
    onError(error) {
      logger.warn('frame sampling failed', error.message);
      statusUi.setStatus('Frame capture unavailable; transcript scan continues.');
    }
  });

  return () => {
    stopped = true;
    stopFrames?.();
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

function updateCandidates(evidence: TimedEvidence[], statusUi: { setCandidates(count: number): void }): void {
  const candidates = buildSegmentCandidates(evidence);
  statusUi.setCandidates(candidates.length);
  logger.info('segment candidates updated', candidates);
}
