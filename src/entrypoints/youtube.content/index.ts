import './style.css';
import { buildSegmentCandidates } from '../../core/analysis/evidence-fusion';
import { detectProgressBarCue } from '../../core/analysis/progress-bar-detector';
import { detectQrCue } from '../../core/analysis/qr-detector';
import { calculateFrameScanProgress, isVideoPlaybackComplete } from '../../core/analysis/scan-progress';
import {
  isCapturePermissionMissingError,
  isExtensionContextInvalidatedError,
  startScreenshotFrameSampler
} from '../../core/analysis/frame-sampler';
import { detectVisibleLinkCue, isVisibleTextDetectionAvailable } from '../../core/analysis/link-detector';
import { analyzeTranscriptCues } from '../../core/analysis/transcript-analyzer';
import { FEEDBACK_ENDPOINT_STORAGE_KEY, MODEL_CACHE_STORAGE_KEY } from '../../core/extension-settings';
import { normalizeFeedbackEndpoint } from '../../core/feedback';
import {
  applyModelToCandidates,
  validateCandidateModel,
  type CandidateModelArtifact,
  type CandidateModelSource
} from '../../core/model/candidate-model';
import {
  appendScanStatusEvidence,
  appendScanStatusEvent,
  createIdleScanStatus,
  createEmptyEvidenceCounts,
  createFallbackModelState,
  mergeScanStatus,
  type ScanEvidenceCounts,
  type ScanStatusCandidate,
  type ScanStatusCandidateEvidence,
  type ScanStatusModelState,
  type ScanStatusPatch,
  type ScanStatusPhase
} from '../../core/scan-status';
import { writeStoredScanStatus } from '../../core/scan-status-storage';
import type { EvidenceSource, SegmentCandidate, TimedEvidence, TranscriptCue } from '../../core/types';
import { createYouTubeAdapter } from '../../platform/youtube/youtube-adapter';
import { observeLocationChanges } from '../../platform/youtube/route-observer';
import { formatCandidateSummary } from '../../ui/candidate-summary';
import { createLogger } from '../../ui/logger';

const logger = createLogger('youtube-content');
const SEEK_TO_MESSAGE_TYPE = 'YAPSKIPPR_SEEK_TO';
const FAST_SCAN_MESSAGE_TYPE = 'YAPSKIPPR_SET_FAST_SCAN';
const NORMAL_SAMPLE_INTERVAL_MS = 5000;
const FRAME_SAMPLE_WIDTH = 640;

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

interface ActiveCandidateModelState {
  model: CandidateModelArtifact | null;
  modelSource: CandidateModelSource;
  status: ScanStatusModelState;
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
  let transcriptCues: TranscriptCue[] = [];
  let activeCandidateModel = createFallbackActiveCandidateModel('No recognition model loaded yet.');
  let stopped = false;
  let sampleCount = 0;
  let lastCandidateCount = 0;
  let completionPublished = false;
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
    fastScanIntervalSeconds,
    model: activeCandidateModel.status
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
    void writeStoredScanStatus(scanStatus).catch((error: unknown) => {
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

  setScanProgress('Loading active recognition model...', 0.12, 'starting');
  activeCandidateModel = await loadActiveCandidateModel();
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
        detail: 'Chrome text detection is still experimental; onscreen links may not be detected unless TextDetector is enabled.'
      }
    );
  }
  setScanProgress('Loading transcript cues...', 0.2, 'transcript', {}, { level: 'info', message: 'Transcript scan started' });

  void adapter
    .loadTranscript()
    .then((cues) => {
      if (stopped) return;
      transcriptCues = cues;
      const transcriptEvidence = analyzeTranscriptCues(cues);
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

  const onVideoEnded = (): void => {
    publishCompletionIfReady(playableVideo.currentTime, getFiniteDuration(playableVideo));
  };
  playableVideo.addEventListener('ended', onVideoEnded);

  function restartFrameSampling(): void {
    stopFrames?.();
    stopFrames = startScreenshotFrameSampler(playableVideo, {
      width: FRAME_SAMPLE_WIDTH,
      sampleIntervalMs: fastScanEnabled ? fastScanIntervalSeconds * 1000 : NORMAL_SAMPLE_INTERVAL_MS,
      async onFrame(frame) {
        sampleCount += 1;
        logger.debug('frame sampled', {
          time: frame.currentTimeSeconds,
          width: frame.width,
          height: frame.height
        });

        const frameEvidence = [...detectProgressBarCue(frame.imageData, frame.currentTimeSeconds)];
        frameEvidence.push(...(await detectQrCue(frame.imageData, frame.currentTimeSeconds)));
        frameEvidence.push(...(await detectVisibleLinkCue(frame.imageData, frame.currentTimeSeconds)));
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
      playableVideo.removeEventListener('ended', onVideoEnded);
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

  function publishCompletionIfReady(currentTimeSeconds: number | null, durationSeconds: number | null): boolean {
    if (completionPublished || !isVideoPlaybackComplete(currentTimeSeconds, durationSeconds)) return completionPublished;

    completionPublished = true;
    stopFrames?.();
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

async function loadActiveCandidateModel(): Promise<ActiveCandidateModelState> {
  const cachedModel = validateCandidateModel(await getLocalStorageValue(MODEL_CACHE_STORAGE_KEY));
  const feedbackEndpoint = normalizeStoredFeedbackEndpoint(await getLocalStorageValue(FEEDBACK_ENDPOINT_STORAGE_KEY));

  if (!feedbackEndpoint) {
    if (cachedModel) {
      return createLoadedModelState(cachedModel, 'downloaded', 'Using cached promoted model. No feedback endpoint is configured.');
    }
    return createFallbackActiveCandidateModel('No feedback endpoint configured; using heuristic confidence.');
  }

  try {
    const response = await fetch(deriveModelEndpoint(feedbackEndpoint), {
      method: 'GET',
      headers: { accept: 'application/json' },
      cache: 'no-store',
      credentials: 'omit'
    });
    if (!response.ok) throw new Error(`Model endpoint returned HTTP ${response.status}.`);

    const model = validateCandidateModel(await response.json());
    if (!model) throw new Error('Model artifact is missing required fields or uses an incompatible feature schema.');

    await setLocalStorageValue(MODEL_CACHE_STORAGE_KEY, model);
    return createLoadedModelState(model, 'downloaded', 'Promoted model loaded from the feedback server.');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (cachedModel) {
      return createLoadedModelState(cachedModel, 'downloaded', `Using cached promoted model. Latest fetch failed: ${message}`);
    }
    return {
      model: null,
      modelSource: 'fallback',
      status: {
        ...createFallbackModelState(`Model unavailable: ${message}`),
        status: 'error'
      }
    };
  }
}

function createLoadedModelState(
  model: CandidateModelArtifact,
  modelSource: CandidateModelSource,
  message: string
): ActiveCandidateModelState {
  return {
    model,
    modelSource,
    status: {
      modelId: model.modelId,
      modelVersion: model.modelVersion,
      modelSource,
      featureSchemaVersion: model.featureSchemaVersion,
      status: 'loaded',
      message
    }
  };
}

function createFallbackActiveCandidateModel(message: string): ActiveCandidateModelState {
  return {
    model: null,
    modelSource: 'fallback',
    status: createFallbackModelState(message)
  };
}

function normalizeStoredFeedbackEndpoint(value: unknown): string | null {
  return typeof value === 'string' ? normalizeFeedbackEndpoint(value) : null;
}

function deriveModelEndpoint(feedbackEndpoint: string): string {
  const url = new URL(feedbackEndpoint);
  if (/\/feedback\/?$/.test(url.pathname)) {
    url.pathname = url.pathname.replace(/\/feedback\/?$/, '/model/latest');
  } else {
    url.pathname = '/api/v1/model/latest';
  }
  url.search = '';
  url.hash = '';
  return url.toString();
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

function summarizeRawEvidence(raw: unknown): string | null {
  if (!isRecord(raw)) return null;

  if (Array.isArray(raw.links)) {
    const links = raw.links.filter((link): link is string => typeof link === 'string' && link.length > 0);
    if (links.length > 0) return links.join(', ');
  }

  if (typeof raw.value === 'string' && raw.value.trim()) return raw.value.trim();
  if (typeof raw.text === 'string' && raw.text.trim()) return raw.text.trim();
  if (typeof raw.contextText === 'string' && raw.contextText.trim()) return raw.contextText.trim();
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
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
