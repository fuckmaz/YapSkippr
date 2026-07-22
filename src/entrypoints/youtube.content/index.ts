import './style.css';
import { createAutoSkipController, type AutoSkipDecision } from '../../core/auto-skip-controller';
import { buildSegmentCandidates } from '../../core/analysis/evidence-fusion';
import { createProgressBarTracker, detectProgressBarCue } from '../../core/analysis/progress-bar-detector';
import { detectQrCue } from '../../core/analysis/qr-detector';
import { shouldScanQrFrame } from '../../core/analysis/qr-scan-cadence';
import { calculateFrameScanProgress, isVideoPlaybackComplete } from '../../core/analysis/scan-progress';
import { summarizeRawEvidence } from '../../core/evidence-detail';
import {
  isCapturePermissionMissingError,
  isExtensionContextInvalidatedError,
  isVideoElementDisconnectedError,
  startScreenshotFrameSampler
} from '../../core/analysis/frame-sampler';
import {
  detectTranscriptLinkCues,
  detectVisibleLinkCue,
  isVisibleTextDetectionAvailable
} from '../../core/analysis/link-detector';
import { analyzeTranscriptCues, parseTranscriptPhraseGroups, type TranscriptPhraseGroup } from '../../core/analysis/transcript-analyzer';
import { AUTO_SKIP_ENABLED_STORAGE_KEY, TRANSCRIPT_PHRASE_GROUPS_STORAGE_KEY } from '../../core/extension-settings';
import { createLatestAsyncControl } from '../../core/latest-async-control';
import {
  createFallbackActiveCandidateModel,
  DEFAULT_MODEL_FETCH_TIMEOUT_MS,
  loadActiveCandidateModel,
  type ActiveCandidateModelState
} from '../../core/model/active-candidate-model';
import { createBoundedOwnedStatusWriter } from '../../core/owned-scan-status-writer';
import { sendRuntimeMessageWithCallback } from '../../core/runtime-message';
import { applyModelToCandidates } from '../../core/model/candidate-model';
import {
  appendScanStatusEvidence,
  appendScanStatusEvent,
  createIdleScanStatus,
  createEmptyEvidenceCounts,
  mergeScanStatus,
  type ScanEvidenceCounts,
  type ScanStatusCandidate,
  type ScanStatusCandidateEvidence,
  type ScanStatusPatch,
  type ScanStatusPhase,
  type ScanStatusSnapshot
} from '../../core/scan-status';
import type { EvidenceSource, SegmentCandidate, TimedEvidence, TranscriptCue } from '../../core/types';
import { isPlayableVideoElement, observePlayableVideoReplacement } from '../../platform/video-element-replacement';
import { createYouTubeAdapter } from '../../platform/youtube/youtube-adapter';
import { observeLocationChanges } from '../../platform/youtube/route-observer';
import { formatCandidateSummary } from '../../ui/candidate-summary';
import { createLogger } from '../../ui/logger';

const logger = createLogger('youtube-content');
const SEEK_TO_MESSAGE_TYPE = 'YAPSKIPPR_SEEK_TO';
const FAST_SCAN_MESSAGE_TYPE = 'YAPSKIPPR_SET_FAST_SCAN';
const SCAN_CAPABILITY_MESSAGE_TYPE = 'YAPSKIPPR_GET_SCAN_CAPABILITY';
const CLAIM_SCAN_STATUS_MESSAGE_TYPE = 'YAPSKIPPR_CLAIM_SCAN_STATUS';
const UPDATE_SCAN_STATUS_MESSAGE_TYPE = 'YAPSKIPPR_UPDATE_SCAN_STATUS';
const NORMAL_SAMPLE_INTERVAL_MS = 5000;
const FRAME_SAMPLE_WIDTH = 960;

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

interface ScanStatusClaimResponse {
  ok: boolean;
  tabId?: number;
  token?: string;
  error?: string;
}

interface ScanStatusUpdateResponse {
  ok: boolean;
  error?: string;
}

interface ScanCapabilityResponse {
  ok: boolean;
  ready: boolean;
  error?: string;
}

interface ActiveScanControl {
  isReady(): boolean;
  stop(): void;
  setFastScan(enabled: boolean, intervalSeconds: number): FastScanResponse;
  setAutoSkip(enabled: boolean): void;
}

export default defineContentScript({
  matches: ['https://youtube.com/*', 'https://www.youtube.com/*', 'https://*.youtube.com/*', 'https://youtu.be/*'],
  cssInjectionMode: 'ui',
  async main(ctx) {
    logger.info('content script loaded');
    const scans = createLatestAsyncControl<ActiveScanControl>();
    let autoSkipEnabled = false;
    let autoSkipPreferenceGeneration = 0;
    const autoSkipStorageListener = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string
    ): void => {
      if (areaName !== 'local' || !changes[AUTO_SKIP_ENABLED_STORAGE_KEY]) return;
      autoSkipPreferenceGeneration += 1;
      autoSkipEnabled = changes[AUTO_SKIP_ENABLED_STORAGE_KEY]?.newValue === true;
      scans.getCurrent()?.setAutoSkip(autoSkipEnabled);
    };
    chrome.storage.onChanged.addListener(autoSkipStorageListener);
    const initialAutoSkipGeneration = autoSkipPreferenceGeneration;
    void getLocalStorageValue(AUTO_SKIP_ENABLED_STORAGE_KEY).then(
      (value) => {
        if (autoSkipPreferenceGeneration !== initialAutoSkipGeneration) return;
        autoSkipEnabled = value === true;
        scans.getCurrent()?.setAutoSkip(autoSkipEnabled);
      },
      (error: unknown) => logger.warn('auto-skip preference unavailable; keeping it off', error)
    );
    const messageListener = (
      message: SeekToRequest | FastScanRequest,
      _sender: chrome.runtime.MessageSender,
      sendResponse: (response: SeekToResponse | FastScanResponse | ScanCapabilityResponse) => void
    ): boolean => {
      if (message?.type === SCAN_CAPABILITY_MESSAGE_TYPE) {
        const ready = scans.getCurrent()?.isReady() === true;
        sendResponse({
          ok: true,
          ready,
          ...(ready ? {} : { error: 'No ready YapSkippr scan is available in this tab.' })
        });
        return false;
      }

      if (message?.type === FAST_SCAN_MESSAGE_TYPE) {
        const activeScan = scans.getCurrent();
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

    function bootForUrl(url: URL): void {
      void scans
        .replace(async (isCurrent) => {
          const routeUrl = url.href;
          const ownedStatusWriter = createBoundedOwnedStatusWriter<ScanStatusSnapshot>({
            routeUrl,
            isCurrent,
            getCurrentUrl: () => location.href,
            claim: claimScanStatusOwnership,
            writeOwned: sendOwnedScanStatus,
            maxClaimAttempts: 3
          });
          await ownedStatusWriter.initialize();
          if (!isCurrent() || location.href !== routeUrl) return undefined;
          const writeScanStatus = (status: ScanStatusSnapshot) => ownedStatusWriter.write(status);
          const adapter = createYouTubeAdapter();
          if (!adapter.matches(url)) {
            logger.debug('url ignored', url.href);
            await writeScanStatus(mergeScanStatus(createIdleScanStatus(), {
              pageUrl: url.href,
              message: 'Open a YouTube video to start scanning.'
            }));
            return undefined;
          }

          logger.info('watch page detected', { videoId: adapter.getVideoId() });
          const bootUrl = routeUrl;
          return startYapSkipprScan(adapter, isCurrent, writeScanStatus, () => {
            if (!isCurrent() || location.href !== bootUrl) return;
            bootForUrl(new URL(bootUrl));
          }, () => autoSkipEnabled);
        })
        .catch((error: unknown) => {
          logger.error('scan lifecycle update failed', error);
        });
    }

    const stopRoutes = observeLocationChanges(bootForUrl);
    ctx.addEventListener(window, 'pagehide', () => {
      try {
        scans.stop();
      } catch (error) {
        logger.error('scan teardown failed', error);
      } finally {
        stopRoutes();
        chrome.storage.onChanged.removeListener(autoSkipStorageListener);
        chrome.runtime.onMessage.removeListener(messageListener);
      }
    });
    bootForUrl(new URL(location.href));
  }
});

async function claimScanStatusOwnership(): Promise<string | null> {
  try {
    const response = await sendRuntimeMessageWithCallback<ScanStatusClaimResponse>({
      type: CLAIM_SCAN_STATUS_MESSAGE_TYPE
    });

    if (!response?.ok || typeof response.token !== 'string' || !response.token) {
      logger.error('scan status persistence disabled: ownership claim rejected', response?.error);
      return null;
    }

    return response.token;
  } catch (error) {
    logger.error('scan status persistence disabled: ownership claim failed', error);
    return null;
  }
}

async function sendOwnedScanStatus(token: string, status: ScanStatusSnapshot): Promise<void> {
  const response = await sendRuntimeMessageWithCallback<ScanStatusUpdateResponse>({
    type: UPDATE_SCAN_STATUS_MESSAGE_TYPE,
    token,
    status
  });
  if (!response?.ok) throw new Error(response?.error ?? 'Background rejected the scan status update.');
}

async function startYapSkipprScan(
  adapter: ReturnType<typeof createYouTubeAdapter>,
  isBootCurrent: () => boolean,
  writeScanStatus: (status: ScanStatusSnapshot) => Promise<void>,
  requestScanReboot: () => void,
  getAutoSkipEnabled: () => boolean
): Promise<ActiveScanControl> {
  const statusUi = await adapter.mountStatusUi();
  let statusUiDestroyed = false;

  function destroyStatusUi(): void {
    if (statusUiDestroyed) return;
    statusUiDestroyed = true;
    statusUi.destroy();
  }

  if (!isBootCurrent()) {
    destroyStatusUi();
    return createInactiveScanControl('Scan startup was replaced.');
  }
  const evidence: TimedEvidence[] = [];
  let transcriptCues: TranscriptCue[] = [];
  let transcriptPhraseGroups: readonly TranscriptPhraseGroup[] = parseTranscriptPhraseGroups(null);
  let activeCandidateModel = createFallbackActiveCandidateModel('No recognition model loaded yet.');
  let stopped = false;
  let sampleCount = 0;
  let lastCandidateCount = 0;
  let completionPublished = false;
  let fastScanEnabled = false;
  let fastScanIntervalSeconds = 2;
  let stopFrames: (() => void) | undefined;
  let stopVideoReplacementWatcher: (() => void) | undefined;
  let endedListenerAttached = false;
  let frameSamplingGeneration = 0;
  let lastQrScanTimeSeconds: number | null = null;
  let boundVideoDisconnected = false;
  let replacementRebootRequested = false;
  let playbackListenerAttached = false;
  let autoSkipCount = 0;
  const progressBarTracker = createProgressBarTracker();
  const autoSkipController = createAutoSkipController({ enabled: getAutoSkipEnabled() });
  let scanStatus = mergeScanStatus(createIdleScanStatus(), {
    platformId: adapter.id,
    videoId: adapter.getVideoId(),
    pageUrl: location.href,
    phase: 'starting',
    message: 'Starting YapSkippr scan...',
    fastScanEnabled,
    fastScanIntervalSeconds,
    model: activeCandidateModel.status
  });

  function isSessionActive(): boolean {
    return isBootCurrent() && !stopped && !completionPublished && !boundVideoDisconnected;
  }

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
    syncPlayerDetails();
    persistScanStatus();
  }

  function publishEvidence(evidenceItems: readonly TimedEvidence[]): void {
    if (evidenceItems.length === 0) return;
    scanStatus = appendScanStatusEvidence(scanStatus, evidenceItems);
    syncPlayerDetails();
    persistScanStatus();
  }

  function persistScanStatus(): void {
    void writeScanStatus(scanStatus).catch((error: unknown) => {
      logger.warn('popup status update failed', error);
    });
  }

  function syncPlayerDetails(): void {
    statusUi.setDetails?.({
      phase: scanStatus.phase,
      sampleCount: scanStatus.sampleCount,
      evidenceCounts: scanStatus.evidenceCounts,
      videoCurrentTimeSeconds: scanStatus.videoCurrentTimeSeconds,
      videoDurationSeconds: scanStatus.videoDurationSeconds
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
    autoSkipController.updateCandidates(candidates);
    publishScanStatus({
      candidateCount: candidates.length,
      evidenceCounts: countEvidenceSources(evidence),
      candidates: candidates.slice(0, 5).map(toScanStatusCandidate)
    }, candidateEvent);
    maybeAutoSkip();
  }

  setScanProgress('Finding YouTube video...', 0.05, 'starting', {}, { level: 'info', message: 'Scan started' });

  const video = await waitForVideo(adapter, 10_000, isBootCurrent);
  if (!isBootCurrent()) {
    stopped = true;
    destroyStatusUi();
    return createInactiveScanControl('Scan startup was replaced.');
  }
  if (!video || stopped) {
    setScanProgress('No playable video found.', 1, 'error', {}, { level: 'error', message: 'No playable video found' });
    return {
      isReady() {
        return false;
      },
      stop() {
        destroyStatusUi();
      },
      setFastScan() {
        return { ok: false, error: 'No playable YouTube video is available.' };
      },
      setAutoSkip() {
        statusUi.showAutoSkipNotice(null);
      }
    };
  }
  const playableVideo = video;
  autoSkipController.setEnabled(getAutoSkipEnabled());

  publishScanStatus({
    videoCurrentTimeSeconds: playableVideo.currentTime,
    videoDurationSeconds: getFiniteDuration(playableVideo),
    fastScanEnabled,
    fastScanIntervalSeconds
  });

  setScanProgress('Loading active recognition model...', 0.12, 'starting');
  try {
    activeCandidateModel = await loadActiveCandidateModel({
      getStorageValue: getLocalStorageValue,
      setStorageValue: setLocalStorageValue,
      fetcher: (input, init) => fetch(input, init),
      isCurrent: isBootCurrent,
      timeoutMs: DEFAULT_MODEL_FETCH_TIMEOUT_MS
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('unexpected recognition model startup failure', error);
    activeCandidateModel = createFallbackActiveCandidateModel(
      `Recognition model startup failed unexpectedly: ${message}. Using heuristic confidence.`
    );
  }
  if (!isBootCurrent()) {
    stopped = true;
    destroyStatusUi();
    return createInactiveScanControl('Scan startup was replaced.');
  }
  publishScanStatus(
    { model: activeCandidateModel.status },
    {
      level: activeCandidateModel.status.status === 'error' ? 'warn' : 'info',
      message: activeCandidateModel.status.status === 'loaded' ? 'Recognition model loaded' : 'Recognition model fallback',
      detail: activeCandidateModel.status.message
    }
  );

  if (!isVisibleTextDetectionAvailable()) {
    publishScanStatus(
      {},
      {
        level: 'warn',
        message: 'Visible-link OCR unavailable',
        detail: 'Using transcript URL detection as a fallback; direct frame OCR requires browser TextDetector support.'
      }
    );
  }
  setScanProgress('Loading transcript cues...', 0.2, 'transcript', {}, { level: 'info', message: 'Transcript scan started' });
  transcriptPhraseGroups = await loadTranscriptPhraseGroups();
  if (!isBootCurrent()) {
    stopped = true;
    destroyStatusUi();
    return createInactiveScanControl('Scan startup was replaced.');
  }

  stopVideoReplacementWatcher = observePlayableVideoReplacement(adapter, playableVideo, () => {
    if (!isBootCurrent() || stopped || completionPublished || replacementRebootRequested) return;

    replacementRebootRequested = true;
    stopped = true;
    cleanupActiveScanResources();
    destroyStatusUi();
    requestScanReboot();
  });

  if (!playableVideo.isConnected && !replacementRebootRequested) {
    publishWaitingForVideoReplacement();
  }

  if (replacementRebootRequested || !isBootCurrent()) {
    stopped = true;
    cleanupActiveScanResources();
    destroyStatusUi();
    return createInactiveScanControl('YouTube replaced the video during scan startup.');
  }

  if (isSessionActive()) {
    void adapter.loadTranscript().then(
      (cues) => {
        if (!isSessionActive()) return;

        try {
          transcriptCues = cues;
          const transcriptEvidence = [
            ...analyzeTranscriptCues(cues, { phraseGroups: transcriptPhraseGroups }),
            ...detectTranscriptLinkCues(cues)
          ];
          evidence.push(...transcriptEvidence);
          logger.info('transcript analyzed', { cues: cues.length, evidence: transcriptEvidence.length });
          publishEvidence(transcriptEvidence);
          publishCandidates(updateCandidates(evidence, statusUi, activeCandidateModel, getFiniteDuration(playableVideo), transcriptCues));
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
        } catch (error) {
          if (!isSessionActive()) return;
          logger.error('transcript processing failed', error);
          setScanProgress(
            'Transcript processing failed; analyzing frames...',
            0.3,
            'frames',
            {},
            {
              level: 'error',
              message: 'Transcript processing failed',
              detail: error instanceof Error ? error.message : String(error)
            }
          );
        }
      },
      (error: unknown) => {
        if (!isSessionActive()) return;
        logger.warn('transcript unavailable', error);
        setScanProgress(
          'Transcript unavailable; analyzing frames...',
          0.3,
          'frames',
          {},
          { level: 'warn', message: 'Transcript unavailable', detail: error instanceof Error ? error.message : String(error) }
        );
      }
    );
  }

  function onVideoEnded(): void {
    if (!isSessionActive()) return;
    publishCompletionIfReady(playableVideo.currentTime, getFiniteDuration(playableVideo));
  }
  function onPlaybackTimeUpdate(): void {
    maybeAutoSkip();
  }
  if (isSessionActive()) {
    playableVideo.addEventListener('ended', onVideoEnded);
    endedListenerAttached = true;
    playableVideo.addEventListener('timeupdate', onPlaybackTimeUpdate);
    playbackListenerAttached = true;
  }

  function restartFrameSampling(): void {
    if (!isSessionActive()) return;

    const generation = ++frameSamplingGeneration;
    stopFrames?.();
    stopFrames = startScreenshotFrameSampler(playableVideo, {
      width: FRAME_SAMPLE_WIDTH,
      sampleIntervalMs: fastScanEnabled ? fastScanIntervalSeconds * 1000 : NORMAL_SAMPLE_INTERVAL_MS,
      async onFrame(frame) {
        if (!isCurrentFrameSamplingGeneration(generation)) return;

        const nextSampleCount = sampleCount + 1;
        const progressEvidence = detectProgressBarCue(frame.imageData, frame.currentTimeSeconds);
        const shouldScanQr = shouldScanQrFrame({
          sampleCount: nextSampleCount,
          currentTimeSeconds: frame.currentTimeSeconds,
          lastQrScanTimeSeconds
        });
        let qrEvidence: TimedEvidence[] = [];
        if (shouldScanQr) {
          qrEvidence = await detectQrCue(frame.imageData, frame.currentTimeSeconds);
          if (!isCurrentFrameSamplingGeneration(generation)) return;
        }
        const visibleLinkEvidence = await detectVisibleLinkCue(frame.imageData, frame.currentTimeSeconds);
        if (!isCurrentFrameSamplingGeneration(generation)) return;

        sampleCount = nextSampleCount;
        if (shouldScanQr) lastQrScanTimeSeconds = frame.currentTimeSeconds;
        const frameEvidence = progressBarTracker.observe(progressEvidence);
        frameEvidence.push(...qrEvidence);
        frameEvidence.push(...visibleLinkEvidence);
        logger.debug('frame sampled', {
          time: frame.currentTimeSeconds,
          width: frame.width,
          height: frame.height
        });
        const durationSeconds = getFiniteDuration(playableVideo);

        if (frameEvidence.length > 0) {
          evidence.push(...frameEvidence);
          logger.info('frame evidence detected', frameEvidence);
          publishEvidence(frameEvidence);
          publishCandidates(updateCandidates(evidence, statusUi, activeCandidateModel, durationSeconds, transcriptCues));
        }

        if (publishCompletionIfReady(frame.currentTimeSeconds, durationSeconds)) return;

        setScanProgress(`Analyzing frames... ${sampleCount} sampled`, calculateFrameScanProgress({
          currentTimeSeconds: frame.currentTimeSeconds,
          durationSeconds,
          sampleCount
        }), 'frames', {
          sampleCount,
          videoCurrentTimeSeconds: frame.currentTimeSeconds,
          videoDurationSeconds: durationSeconds,
          fastScanEnabled,
          fastScanIntervalSeconds,
          evidenceCounts: countEvidenceSources(evidence)
        });
      },
      onError(error) {
        if (!isCurrentFrameSamplingGeneration(generation)) return;

        if (isVideoElementDisconnectedError(error)) {
          logger.info('frame sampling paused while YouTube replaces the video element');
          publishWaitingForVideoReplacement(error);
          return;
        }
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
    isReady() {
      return isSessionActive() && playableVideo.isConnected;
    },
    stop() {
      if (stopped) {
        cleanupActiveScanResources();
        destroyStatusUi();
        return;
      }
      const shouldPublishStoppedStatus = isBootCurrent() && !completionPublished;
      stopped = true;
      cleanupActiveScanResources();
      if (shouldPublishStoppedStatus) {
        publishScanStatus({ phase: 'stopped', message: 'Scan stopped.' }, { level: 'info', message: 'Scan stopped' });
      }
      destroyStatusUi();
    },
    setFastScan(enabled: boolean, intervalSeconds: number): FastScanResponse {
      if (stopped) return { ok: false, error: 'Scan is already stopped.' };
      if (completionPublished) return { ok: false, error: 'Scan is already complete.' };
      if (boundVideoDisconnected || !playableVideo.isConnected) {
        publishWaitingForVideoReplacement();
        return { ok: false, error: 'Waiting for YouTube to finish replacing the video player.' };
      }

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
    },
    setAutoSkip(enabled: boolean): void {
      if (autoSkipController.isEnabled() === enabled) return;
      autoSkipController.setEnabled(enabled);
      if (!enabled) statusUi.showAutoSkipNotice(null);
      publishScanStatus({}, {
        level: 'info',
        message: enabled ? 'Auto-skip enabled' : 'Auto-skip disabled',
        detail: enabled
          ? 'Only high-confidence segments with detected endings will be skipped.'
          : 'Detected segments will not change playback automatically.'
      });
    }
  };

  function maybeAutoSkip(): void {
    if (!isSessionActive() || !playableVideo.isConnected) return;
    const decision = autoSkipController.evaluate({
      currentTimeSeconds: playableVideo.currentTime,
      durationSeconds: getFiniteDuration(playableVideo),
      isPlaying: !playableVideo.paused && !playableVideo.ended
    });
    if (!decision) return;

    autoSkipCount += 1;
    playableVideo.currentTime = decision.toSeconds;
    statusUi.setStatus(`Auto-skipped ${formatDuration(decision.skippedSeconds)} of detected ad read.`);
    statusUi.showAutoSkipNotice({
      skippedSeconds: decision.skippedSeconds,
      onUndo: () => undoAutoSkip(decision)
    });
    publishScanStatus({
      videoCurrentTimeSeconds: decision.toSeconds
    }, {
      level: 'info',
      message: 'Auto-skipped detected ad read',
      detail: `${formatTimestamp(decision.fromSeconds)} → ${formatTimestamp(decision.toSeconds)} · ${Math.round(decision.confidence * 100)}% confidence · skip ${autoSkipCount}`
    });
  }

  function undoAutoSkip(expectedDecision: AutoSkipDecision): void {
    if (!isSessionActive()) return;
    const undo = autoSkipController.undoLast();
    if (!undo || undo.decision.id !== expectedDecision.id) return;

    const shouldResumePlayback = !playableVideo.paused;
    playableVideo.currentTime = clamp(
      undo.targetSeconds,
      0,
      Number.isFinite(playableVideo.duration) ? playableVideo.duration : undo.targetSeconds
    );
    if (shouldResumePlayback) void playableVideo.play().catch(() => undefined);
    statusUi.setStatus('Auto-skip undone. This segment will not be skipped again.');
    statusUi.showAutoSkipNotice(null);
    publishScanStatus({
      videoCurrentTimeSeconds: playableVideo.currentTime
    }, {
      level: 'info',
      message: 'Auto-skip undone',
      detail: `Returned to ${formatTimestamp(playableVideo.currentTime)}; this segment is suppressed for the current video.`
    });
  }

  function publishCompletionIfReady(currentTimeSeconds: number | null, durationSeconds: number | null): boolean {
    if (completionPublished) return true;
    if (!isSessionActive() || !isVideoPlaybackComplete(currentTimeSeconds, durationSeconds)) return false;

    completionPublished = true;
    cleanupActiveScanResources();
    setScanProgress(
      'Scan complete. Video watched to the end.',
      1,
      'done',
      {
        sampleCount,
        videoCurrentTimeSeconds: currentTimeSeconds,
        videoDurationSeconds: durationSeconds,
        evidenceCounts: countEvidenceSources(evidence)
      },
      {
        level: 'info',
        message: 'Scan complete',
        detail: `${sampleCount} frames sampled, ${evidence.length} evidence hits`
      }
    );
    return true;
  }

  function isCurrentFrameSamplingGeneration(generation: number): boolean {
    return isSessionActive() && generation === frameSamplingGeneration;
  }

  function cleanupActiveScanResources(): void {
    frameSamplingGeneration += 1;
    stopFrames?.();
    stopFrames = undefined;
    if (endedListenerAttached) {
      playableVideo.removeEventListener('ended', onVideoEnded);
      endedListenerAttached = false;
    }
    if (playbackListenerAttached) {
      playableVideo.removeEventListener('timeupdate', onPlaybackTimeUpdate);
      playbackListenerAttached = false;
    }
    statusUi.showAutoSkipNotice(null);
    autoSkipController.resetSession();
    stopVideoReplacementWatcher?.();
    stopVideoReplacementWatcher = undefined;
  }

  function publishWaitingForVideoReplacement(error?: Error): void {
    if (boundVideoDisconnected || stopped || completionPublished || !isBootCurrent()) return;

    boundVideoDisconnected = true;
    fastScanEnabled = false;
    frameSamplingGeneration += 1;
    stopFrames?.();
    stopFrames = undefined;
    setScanProgress(
      'YouTube replaced the video player. Waiting for the new video...',
      scanStatus.progress,
      'starting',
      { fastScanEnabled: false },
      {
        level: 'info',
        message: 'Waiting for replacement video',
        ...(error ? { detail: error.message } : {})
      }
    );
  }
}

async function waitForVideo(
  adapter: ReturnType<typeof createYouTubeAdapter>,
  timeoutMs = 10_000,
  shouldContinue: () => boolean = () => true
): Promise<HTMLVideoElement | null> {
  const startedAt = Date.now();
  while (shouldContinue() && Date.now() - startedAt < timeoutMs) {
    const video = adapter.getVideoElement();
    if (video && isPlayableVideoElement(video)) return video;
    await new Promise((resolve) => window.setTimeout(resolve, 250));
  }
  if (!shouldContinue()) return null;
  const video = adapter.getVideoElement();
  return video && isPlayableVideoElement(video) ? video : null;
}

function createInactiveScanControl(error: string): ActiveScanControl {
  return {
    isReady() {
      return false;
    },
    stop() {},
    setFastScan() {
      return { ok: false, error };
    },
    setAutoSkip() {
      // No active playback session to update.
    }
  };
}

function updateCandidates(
  evidence: TimedEvidence[],
  statusUi: { setCandidates(candidates: ReturnType<typeof buildSegmentCandidates>): void },
  activeModel: ActiveCandidateModelState,
  videoDurationSeconds: number | null,
  transcriptCues: readonly TranscriptCue[]
): ReturnType<typeof buildSegmentCandidates> {
  const candidates = applyModelToCandidates(buildSegmentCandidates(evidence), {
    model: activeModel.model,
    modelSource: activeModel.modelSource,
    videoDurationSeconds,
    getTranscriptContext: (candidate) => getTranscriptContext(transcriptCues, candidate)
  });
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
    ...(candidate.heuristicConfidence === undefined ? {} : { heuristicConfidence: candidate.heuristicConfidence }),
    ...(candidate.modelConfidence === undefined ? {} : { modelConfidence: candidate.modelConfidence }),
    modelId: candidate.modelId ?? null,
    modelVersion: candidate.modelVersion ?? null,
    ...(candidate.modelSource === undefined ? {} : { modelSource: candidate.modelSource }),
    ...(candidate.featureSchemaVersion === undefined ? {} : { featureSchemaVersion: candidate.featureSchemaVersion }),
    ...(candidate.candidateFeatures === undefined ? {} : { candidateFeatures: candidate.candidateFeatures }),
    evidenceSnapshot: candidate.evidence.map(toCandidateEvidenceSnapshot),
    ...(candidate.transcriptContext ? { transcriptContext: candidate.transcriptContext } : {}),
    summary: formatCandidateSummary(candidate),
    sources: getCandidateSourceLabels(candidate)
  };
}

function toCandidateEvidenceSnapshot(evidence: TimedEvidence): ScanStatusCandidateEvidence {
  return {
    source: evidence.source,
    kind: evidence.kind,
    startSeconds: evidence.startSeconds,
    ...(evidence.endSeconds === undefined ? {} : { endSeconds: evidence.endSeconds }),
    confidence: evidence.confidence,
    reason: evidence.reason,
    ...(summarizeRawEvidence(evidence.raw) ? { detail: summarizeRawEvidence(evidence.raw) as string } : {})
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

function formatEvidenceSource(source: EvidenceSource): string {
  if (source === 'transcript') return 'transcript';
  if (source === 'frame-qr-code') return 'QR';
  if (source === 'frame-visible-link') return 'visible link';
  return 'progress bar';
}

function getTranscriptContext(cues: readonly TranscriptCue[], candidate: SegmentCandidate, windowSeconds = 20): string {
  if (cues.length === 0) return '';
  const startSeconds = Math.max(0, candidate.startSeconds - windowSeconds);
  const endSeconds = (candidate.endSeconds ?? candidate.startSeconds) + windowSeconds;

  return cues
    .filter((cue) => cue.startSeconds + cue.durationSeconds >= startSeconds && cue.startSeconds <= endSeconds)
    .map((cue) => cue.text)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function loadTranscriptPhraseGroups(): Promise<readonly TranscriptPhraseGroup[]> {
  try {
    return parseTranscriptPhraseGroups(await getLocalStorageValue(TRANSCRIPT_PHRASE_GROUPS_STORAGE_KEY));
  } catch (error) {
    logger.warn('transcript phrase settings unavailable; using defaults', error);
    return parseTranscriptPhraseGroups(null);
  }
}

function getLocalStorageValue(key: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(key, (items) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve(items[key]);
    });
  });
}

function setLocalStorageValue(key: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set({ [key]: value }, () => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve();
    });
  });
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

function formatTimestamp(seconds: number): string {
  const rounded = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(rounded / 60);
  const remainingSeconds = rounded % 60;
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}

function formatDuration(seconds: number): string {
  const rounded = Math.max(1, Math.round(seconds));
  if (rounded < 60) return `${rounded}s`;
  const minutes = Math.floor(rounded / 60);
  const remainingSeconds = rounded % 60;
  return remainingSeconds === 0 ? `${minutes}m` : `${minutes}m ${remainingSeconds}s`;
}
