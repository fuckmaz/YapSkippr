import './style.css';
import {
  CLIENT_ID_STORAGE_KEY,
  FEEDBACK_ENDPOINT_STORAGE_KEY,
  TRANSCRIPT_PHRASE_GROUPS_STORAGE_KEY
} from '../../core/extension-settings';
import {
  DEFAULT_TRANSCRIPT_PHRASE_GROUPS,
  formatTranscriptPhraseGroupsForEditing,
  parseTranscriptPhraseGroups,
  parseTranscriptPhraseGroupsJson
} from '../../core/analysis/transcript-analyzer';
import {
  OCCURRENCE_FEEDBACK_ACTIONS,
  createOccurrenceFeedbackPayload,
  deriveAdminDashboardUrl,
  normalizeFeedbackEndpoint,
  type OccurrenceFeedbackAction,
  type OccurrenceFeedbackValue,
  type OccurrenceFeedbackType
} from '../../core/feedback';
import { createIdleScanStatus, type ScanStatusEvidence, type ScanStatusSnapshot } from '../../core/scan-status';
import { readStoredScanStatus, subscribeToStoredScanStatus } from '../../core/scan-status-storage';
import { createPopupScanStatusView } from '../../ui/popup-scan-status-view';

const frameCaptureOrigins = ['<all_urls>'];
const seekToMessageType = 'YAPSKIPPR_SEEK_TO';
const fastScanMessageType = 'YAPSKIPPR_SET_FAST_SCAN';
const status = document.querySelector('#status');
const basicModeToggle = document.querySelector<HTMLButtonElement>('#basic-mode-toggle');
const detailedModeToggle = document.querySelector<HTMLButtonElement>('#detailed-mode-toggle');
const permissionStatus = document.querySelector('#permission-status');
const grantAccessButton = document.querySelector<HTMLButtonElement>('#grant-access');
const scanTitle = document.querySelector('#scan-title');
const scanPhase = document.querySelector('#scan-phase');
const scanMessage = document.querySelector('#scan-message');
const scanProgressText = document.querySelector('#scan-progress-text');
const scanProgressBar = document.querySelector<HTMLElement>('#scan-progress-bar');
const scanTime = document.querySelector('#scan-time');
const scanSamples = document.querySelector('#scan-samples');
const scanCandidateCount = document.querySelector('#scan-candidate-count');
const evidenceTranscript = document.querySelector('#evidence-transcript');
const evidenceProgress = document.querySelector('#evidence-progress');
const evidenceQr = document.querySelector('#evidence-qr');
const evidenceLinks = document.querySelector('#evidence-links');
const fastScanInterval = document.querySelector<HTMLSelectElement>('#fast-scan-interval');
const fastScanToggle = document.querySelector<HTMLButtonElement>('#fast-scan-toggle');
const fastScanStatus = document.querySelector('#fast-scan-status');
const scanCandidates = document.querySelector<HTMLOListElement>('#scan-candidates');
const candidateActionStatus = document.querySelector('#candidate-action-status');
const scanEvents = document.querySelector<HTMLOListElement>('#scan-events');
const developerPanel = document.querySelector<HTMLElement>('#developer-panel');
const detailVideoId = document.querySelector('#detail-video-id');
const detailPageUrl = document.querySelector('#detail-page-url');
const detailTotalEvidence = document.querySelector('#detail-total-evidence');
const detailModel = document.querySelector('#detail-model');
const detailModelSource = document.querySelector('#detail-model-source');
const detailModelSchema = document.querySelector('#detail-model-schema');
const detailModelMessage = document.querySelector('#detail-model-message');
const detailUpdated = document.querySelector('#detail-updated');
const feedbackEndpointInput = document.querySelector<HTMLInputElement>('#feedback-endpoint');
const saveFeedbackEndpointButton = document.querySelector<HTMLButtonElement>('#save-feedback-endpoint');
const adminDashboardLink = document.querySelector<HTMLAnchorElement>('#admin-dashboard-link');
const feedbackStatus = document.querySelector('#feedback-status');
const transcriptPhraseGroupsInput = document.querySelector<HTMLTextAreaElement>('#transcript-phrase-groups');
const saveTranscriptPhraseGroupsButton = document.querySelector<HTMLButtonElement>('#save-transcript-phrase-groups');
const resetTranscriptPhraseGroupsButton = document.querySelector<HTMLButtonElement>('#reset-transcript-phrase-groups');
const transcriptPhraseStatus = document.querySelector('#transcript-phrase-status');
const scanEvidenceEvents = document.querySelector<HTMLOListElement>('#scan-evidence-events');
const scanUpdated = document.querySelector('#scan-updated');
let currentScanStatus: ScanStatusSnapshot = createIdleScanStatus();
let feedbackEndpoint: string | null = null;

status?.replaceChildren(document.createTextNode('Detection status is mirrored here while a YouTube tab is scanning.'));

grantAccessButton?.addEventListener('click', () => {
  void requestFrameCaptureAccess();
});

scanCandidates?.addEventListener('click', (event) => {
  const feedbackButton = event.target instanceof HTMLElement ? event.target.closest<HTMLButtonElement>('button[data-feedback]') : null;
  if (feedbackButton) {
    void sendFeedbackForButton(feedbackButton);
    return;
  }

  const button = event.target instanceof HTMLElement ? event.target.closest<HTMLButtonElement>('button[data-seek-seconds]') : null;
  const seekSeconds = Number(button?.dataset.seekSeconds);
  if (!button || !Number.isFinite(seekSeconds)) return;

  void seekActiveTabTo(seekSeconds, button.textContent?.trim() ?? 'candidate');
});

fastScanToggle?.addEventListener('click', () => {
  const enable = fastScanToggle.dataset.enabled !== 'true';
  const intervalSeconds = Number(fastScanInterval?.value ?? 2);
  void setFastScan(enable, intervalSeconds);
});

scanEvidenceEvents?.addEventListener('click', (event) => {
  const feedbackButton = event.target instanceof HTMLElement ? event.target.closest<HTMLButtonElement>('button[data-feedback]') : null;
  if (!feedbackButton) return;
  void sendFeedbackForButton(feedbackButton);
});

basicModeToggle?.addEventListener('click', () => setDetailedMode(false));
detailedModeToggle?.addEventListener('click', () => setDetailedMode(true));

saveFeedbackEndpointButton?.addEventListener('click', () => {
  void saveFeedbackEndpoint();
});

saveTranscriptPhraseGroupsButton?.addEventListener('click', () => {
  void saveTranscriptPhraseGroups();
});

resetTranscriptPhraseGroupsButton?.addEventListener('click', () => {
  void resetTranscriptPhraseGroups();
});

renderScanStatus(createIdleScanStatus());
void loadScanStatus();
void loadFeedbackEndpoint();
void loadTranscriptPhraseGroups();
const stopScanStatusSubscription = subscribeToStoredScanStatus(renderScanStatus);
window.addEventListener('pagehide', stopScanStatusSubscription, { once: true });

void refreshFrameCaptureAccess();

async function loadScanStatus(): Promise<void> {
  try {
    renderScanStatus(await readStoredScanStatus());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    renderScanStatus(createIdleScanStatus());
    scanMessage?.replaceChildren(document.createTextNode(`Could not load scan status: ${message}`));
  }
}

function renderScanStatus(statusSnapshot = createIdleScanStatus()): void {
  currentScanStatus = statusSnapshot;
  const view = createPopupScanStatusView(statusSnapshot);

  scanTitle?.replaceChildren(document.createTextNode(view.title));
  scanPhase?.replaceChildren(document.createTextNode(view.phaseLabel));
  scanMessage?.replaceChildren(document.createTextNode(view.message));
  scanProgressText?.replaceChildren(document.createTextNode(view.progressText));
  scanProgressBar?.style.setProperty('width', view.progressText);
  scanTime?.replaceChildren(document.createTextNode(view.videoTimeText));
  scanSamples?.replaceChildren(document.createTextNode(view.sampleCountText));
  scanCandidateCount?.replaceChildren(document.createTextNode(view.candidateCountText));
  evidenceTranscript?.replaceChildren(document.createTextNode(view.evidenceItems[0]?.value ?? '0'));
  evidenceProgress?.replaceChildren(document.createTextNode(view.evidenceItems[1]?.value ?? '0'));
  evidenceQr?.replaceChildren(document.createTextNode(view.evidenceItems[2]?.value ?? '0'));
  evidenceLinks?.replaceChildren(document.createTextNode(view.evidenceItems[3]?.value ?? '0'));
  fastScanStatus?.replaceChildren(document.createTextNode(view.fastScanText));
  fastScanToggle?.replaceChildren(document.createTextNode(statusSnapshot.fastScanEnabled ? 'Stop fast pre-scan' : 'Start fast pre-scan'));
  if (fastScanToggle) fastScanToggle.dataset.enabled = String(statusSnapshot.fastScanEnabled);
  if (fastScanInterval && document.activeElement !== fastScanInterval) {
    fastScanInterval.value = String(statusSnapshot.fastScanIntervalSeconds);
  }
  scanUpdated?.replaceChildren(document.createTextNode(view.updatedText));

  scanCandidates?.replaceChildren(
    ...view.candidates.map((candidate) => {
      const item = document.createElement('li');
      const copy = document.createElement('div');
      const actions = document.createElement('div');
      const summary = document.createElement('strong');
      const detail = document.createElement('span');
      const button = document.createElement('button');

      copy.className = 'candidate-copy';
      actions.className = 'candidate-actions';
      summary.textContent = candidate.summary;
      detail.textContent = candidate.detail;
      button.className = 'candidate-action';
      button.type = 'button';
      button.dataset.seekSeconds = String(candidate.seekSeconds);
      button.textContent = candidate.actionLabel;

      copy.append(summary, detail);
      actions.append(button, ...createFeedbackButtons({
        occurrenceId: candidate.id,
        occurrenceType: 'candidate',
        startSeconds: candidate.seekSeconds,
        summary: candidate.summary,
        reason: candidate.detail
      }));
      item.append(copy, actions);
      return item;
    })
  );

  scanEvents?.replaceChildren(
    ...view.events.map((event) => {
      const item = document.createElement('li');
      const copy = document.createElement('span');
      const message = document.createElement('strong');
      const age = document.createElement('time');
      const detail = document.createElement('small');

      item.dataset.level = event.level;
      message.textContent = event.message;
      age.textContent = event.ageText;
      copy.append(message);
      if (event.detail) {
        detail.textContent = event.detail;
        copy.append(detail);
      }
      item.append(copy, age);
      return item;
    })
  );

  detailVideoId?.replaceChildren(document.createTextNode(statusSnapshot.videoId ?? '-'));
  detailPageUrl?.replaceChildren(document.createTextNode(statusSnapshot.pageUrl ?? '-'));
  detailTotalEvidence?.replaceChildren(document.createTextNode(String(statusSnapshot.evidenceCounts.total)));
  detailModel?.replaceChildren(document.createTextNode(view.modelText));
  detailModelSource?.replaceChildren(document.createTextNode(statusSnapshot.model.modelSource));
  detailModelSchema?.replaceChildren(document.createTextNode(statusSnapshot.model.featureSchemaVersion === null ? '-' : String(statusSnapshot.model.featureSchemaVersion)));
  detailModelMessage?.replaceChildren(document.createTextNode(statusSnapshot.model.message));
  detailUpdated?.replaceChildren(document.createTextNode(view.updatedText));
  scanEvidenceEvents?.replaceChildren(
    ...view.evidenceEvents.map((evidence) => {
      const item = document.createElement('li');
      const copy = document.createElement('div');
      const heading = document.createElement('strong');
      const detail = document.createElement('span');
      const reason = document.createElement('small');
      const actions = document.createElement('div');

      copy.className = 'evidence-copy';
      actions.className = 'feedback-actions';
      heading.textContent = `${evidence.sourceLabel} · ${evidence.kindLabel} · ${evidence.timeLabel} · ${evidence.confidenceText}`;
      detail.textContent = evidence.detail ?? 'No raw detail captured';
      reason.textContent = evidence.reason;
      copy.append(heading, detail, reason);
      actions.append(...createFeedbackButtons({
        occurrenceId: evidence.id,
        occurrenceType: 'evidence',
        source: evidence.sourceLabel,
        startSeconds: evidence.startSeconds,
        summary: `${evidence.sourceLabel} evidence at ${evidence.timeLabel}`,
        reason: evidence.reason
      }));
      item.append(copy, actions);
      return item;
    })
  );
}

async function refreshFrameCaptureAccess(): Promise<void> {
  setPermissionStatus('Checking frame capture access...');

  try {
    const granted = await containsFrameCaptureAccess();
    updateAccessState(granted);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setPermissionStatus(`Could not check access: ${message}`);
  }
}

async function requestFrameCaptureAccess(): Promise<void> {
  grantAccessButton?.setAttribute('disabled', 'true');
  setPermissionStatus('Requesting frame capture access...');

  try {
    const granted = await requestPermissions({ origins: frameCaptureOrigins });
    updateAccessState(granted);
    if (granted) {
      setPermissionStatus('Frame capture access granted. Reload the YouTube tab to restart analysis.');
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setPermissionStatus(`Access request failed: ${message}`);
    grantAccessButton?.removeAttribute('disabled');
  }
}

function updateAccessState(granted: boolean): void {
  if (granted) {
    grantAccessButton?.setAttribute('disabled', 'true');
    setPermissionStatus('Frame capture access is enabled.');
    return;
  }

  grantAccessButton?.removeAttribute('disabled');
  setPermissionStatus('Frame capture access is required for visual ad-read detection.');
}

function setPermissionStatus(message: string): void {
  permissionStatus?.replaceChildren(document.createTextNode(message));
}

function containsFrameCaptureAccess(): Promise<boolean> {
  return new Promise((resolve, reject) => {
    chrome.permissions.contains({ origins: frameCaptureOrigins }, (result) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve(result);
    });
  });
}

function requestPermissions(permissions: chrome.permissions.Permissions): Promise<boolean> {
  return new Promise((resolve, reject) => {
    chrome.permissions.request(permissions, (granted) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve(granted);
    });
  });
}

async function seekActiveTabTo(seconds: number, label: string): Promise<void> {
  setCandidateActionStatus(`Opening ${label}...`);

  try {
    const tabId = await getActiveTabId();
    const response = await sendSeekMessage(tabId, seconds);
    if (!response.ok) {
      throw new Error(response.error ?? 'YouTube tab did not accept the seek request.');
    }
    setCandidateActionStatus(`Jumped to ${label.replace(/^Jump to\s+/i, '')}.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setCandidateActionStatus(`Jump failed: ${message}`);
  }
}

async function setFastScan(enabled: boolean, intervalSeconds: number): Promise<void> {
  const safeIntervalSeconds = clampIntervalSeconds(intervalSeconds);
  setFastScanStatus(`${enabled ? 'Starting' : 'Stopping'} fast pre-scan...`);

  try {
    const tabId = await getActiveTabId();
    const response = await sendFastScanMessage(tabId, enabled, safeIntervalSeconds);
    if (!response.ok) {
      throw new Error(response.error ?? 'YouTube tab did not accept fast pre-scan settings.');
    }
    setFastScanStatus(enabled ? `Fast pre-scan on · ${safeIntervalSeconds}s interval` : 'Fast pre-scan off');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setFastScanStatus(`Fast pre-scan failed: ${message}`);
  }
}

function setFastScanStatus(message: string): void {
  fastScanStatus?.replaceChildren(document.createTextNode(message));
}

function setCandidateActionStatus(message: string): void {
  candidateActionStatus?.replaceChildren(document.createTextNode(message));
}

function setFeedbackStatus(message: string): void {
  feedbackStatus?.replaceChildren(document.createTextNode(message));
}

function updateAdminDashboardLink(endpoint: string | null): void {
  if (!adminDashboardLink) return;
  const adminUrl = deriveAdminDashboardUrl(endpoint);
  if (!adminUrl) {
    adminDashboardLink.hidden = true;
    adminDashboardLink.removeAttribute('href');
    return;
  }

  adminDashboardLink.hidden = false;
  adminDashboardLink.href = adminUrl;
}

function setTranscriptPhraseStatus(message: string): void {
  transcriptPhraseStatus?.replaceChildren(document.createTextNode(message));
}

function setDetailedMode(enabled: boolean): void {
  if (developerPanel) developerPanel.hidden = !enabled;
  if (basicModeToggle) basicModeToggle.dataset.active = String(!enabled);
  if (detailedModeToggle) detailedModeToggle.dataset.active = String(enabled);
}

async function loadFeedbackEndpoint(): Promise<void> {
  try {
    const value = await getLocalStorageValue(FEEDBACK_ENDPOINT_STORAGE_KEY);
    feedbackEndpoint = typeof value === 'string' ? normalizeFeedbackEndpoint(value) : null;
    if (feedbackEndpointInput && feedbackEndpoint) feedbackEndpointInput.value = feedbackEndpoint;
    updateAdminDashboardLink(feedbackEndpoint);
    setFeedbackStatus(feedbackEndpoint ? 'Feedback endpoint ready.' : 'Feedback is local until an endpoint is saved.');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    updateAdminDashboardLink(null);
    setFeedbackStatus(`Could not load feedback endpoint: ${message}`);
  }
}

async function saveFeedbackEndpoint(): Promise<void> {
  const normalized = normalizeFeedbackEndpoint(feedbackEndpointInput?.value ?? '');
  if (!normalized) {
    feedbackEndpoint = null;
    await setLocalStorageValue(FEEDBACK_ENDPOINT_STORAGE_KEY, '');
    updateAdminDashboardLink(null);
    setFeedbackStatus('Enter an http(s) feedback endpoint before sending reports.');
    return;
  }

  feedbackEndpoint = normalized;
  await setLocalStorageValue(FEEDBACK_ENDPOINT_STORAGE_KEY, normalized);
  updateAdminDashboardLink(normalized);
  setFeedbackStatus('Feedback endpoint saved. Admin dashboard link ready.');
}

async function loadTranscriptPhraseGroups(): Promise<void> {
  try {
    const value = await getLocalStorageValue(TRANSCRIPT_PHRASE_GROUPS_STORAGE_KEY);
    const groups = parseTranscriptPhraseGroups(value);
    if (transcriptPhraseGroupsInput) {
      transcriptPhraseGroupsInput.value = formatTranscriptPhraseGroupsForEditing(groups);
    }
    setTranscriptPhraseStatus(value === undefined ? 'Default transcript phrases active.' : `${groups.length} transcript phrase groups loaded.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (transcriptPhraseGroupsInput) {
      transcriptPhraseGroupsInput.value = formatTranscriptPhraseGroupsForEditing(DEFAULT_TRANSCRIPT_PHRASE_GROUPS);
    }
    setTranscriptPhraseStatus(`Could not load transcript phrases: ${message}`);
  }
}

async function saveTranscriptPhraseGroups(): Promise<void> {
  const parsed = parseTranscriptPhraseGroupsJson(transcriptPhraseGroupsInput?.value ?? '');
  if (!parsed.ok) {
    setTranscriptPhraseStatus(parsed.error);
    return;
  }

  await setLocalStorageValue(TRANSCRIPT_PHRASE_GROUPS_STORAGE_KEY, parsed.groups);
  if (transcriptPhraseGroupsInput) {
    transcriptPhraseGroupsInput.value = formatTranscriptPhraseGroupsForEditing(parsed.groups);
  }
  setTranscriptPhraseStatus(`Transcript phrase groups saved. Reload the YouTube tab to apply ${parsed.groups.length} groups.`);
}

async function resetTranscriptPhraseGroups(): Promise<void> {
  await removeLocalStorageValue(TRANSCRIPT_PHRASE_GROUPS_STORAGE_KEY);
  if (transcriptPhraseGroupsInput) {
    transcriptPhraseGroupsInput.value = formatTranscriptPhraseGroupsForEditing(DEFAULT_TRANSCRIPT_PHRASE_GROUPS);
  }
  setTranscriptPhraseStatus('Default transcript phrases restored. Reload the YouTube tab to apply defaults.');
}

async function sendFeedbackForButton(button: HTMLButtonElement): Promise<void> {
  if (!feedbackEndpoint) {
    setFeedbackStatus('Set and save a feedback API endpoint in detailed mode first.');
    setDetailedMode(true);
    return;
  }

  const startSeconds = Number(button.dataset.startSeconds);
  const feedback = button.dataset.feedback as OccurrenceFeedbackValue | undefined;
  const occurrenceType = button.dataset.occurrenceType as OccurrenceFeedbackType | undefined;
  if (!Number.isFinite(startSeconds) || !feedback || !occurrenceType) {
    setFeedbackStatus('Feedback target is missing required occurrence data.');
    return;
  }

  button.disabled = true;
  setFeedbackStatus('Sending feedback...');

  try {
    const clientId = await loadAnonymousClientId();
    const payload = createOccurrenceFeedbackPayload({
      ...(clientId ? { clientId } : {}),
      videoUrl: currentScanStatus.pageUrl,
      videoId: currentScanStatus.videoId,
      occurrenceId: button.dataset.occurrenceId ?? 'unknown',
      occurrenceType,
      source: button.dataset.source,
      startSeconds,
      summary: button.dataset.summary ?? 'YapSkippr occurrence',
      reason: button.dataset.reason,
      feedback,
      ...getFeedbackContext(button.dataset.occurrenceId ?? 'unknown', occurrenceType)
    });
    const response = await fetch(feedbackEndpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      credentials: 'omit'
    });
    if (!response.ok) {
      throw new Error(`Server returned HTTP ${response.status}.`);
    }
    setFeedbackStatus('Feedback sent.');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setFeedbackStatus(`Feedback failed: ${message}`);
  } finally {
    button.disabled = false;
  }
}

function getFeedbackContext(
  occurrenceId: string,
  occurrenceType: OccurrenceFeedbackType
): Partial<Parameters<typeof createOccurrenceFeedbackPayload>[0]> {
  const candidate = occurrenceType === 'candidate'
    ? currentScanStatus.candidates.find((item) => item.id === occurrenceId)
    : undefined;
  const evidence = occurrenceType === 'evidence'
    ? currentScanStatus.recentEvidence.find((item) => item.id === occurrenceId)
    : undefined;

  return {
    modelId: candidate?.modelId ?? currentScanStatus.model.modelId,
    modelVersion: candidate?.modelVersion ?? currentScanStatus.model.modelVersion,
    modelSource: candidate?.modelSource ?? currentScanStatus.model.modelSource,
    featureSchemaVersion: candidate?.featureSchemaVersion ?? currentScanStatus.model.featureSchemaVersion ?? undefined,
    heuristicConfidence: candidate?.heuristicConfidence,
    modelConfidence: candidate?.modelConfidence,
    candidateFeatures: candidate?.candidateFeatures,
    evidenceSnapshot: candidate?.evidenceSnapshot ?? (evidence ? [toFeedbackEvidenceSnapshot(evidence)] : undefined),
    transcriptContext: candidate?.transcriptContext
  };
}

async function loadAnonymousClientId(): Promise<string | null> {
  try {
    const stored = await getLocalStorageValue(CLIENT_ID_STORAGE_KEY);
    if (isValidClientId(stored)) return stored;

    const clientId = createAnonymousClientId();
    await setLocalStorageValue(CLIENT_ID_STORAGE_KEY, clientId);
    return clientId;
  } catch {
    return null;
  }
}

function createAnonymousClientId(): string {
  const randomId = globalThis.crypto?.randomUUID?.()
    ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  return `client_${randomId}`;
}

function isValidClientId(value: unknown): value is string {
  return typeof value === 'string'
    && value.length >= 'client_'.length + 8
    && value.length <= 128
    && /^client_[A-Za-z0-9._:-]+$/.test(value);
}

function toFeedbackEvidenceSnapshot(
  evidence: ScanStatusEvidence
): NonNullable<ReturnType<typeof getFeedbackContext>['evidenceSnapshot']>[number] {
  return {
    source: evidence.source,
    kind: evidence.kind,
    startSeconds: evidence.startSeconds,
    ...(evidence.endSeconds === undefined ? {} : { endSeconds: evidence.endSeconds }),
    confidence: evidence.confidence,
    reason: evidence.reason,
    ...(evidence.detail ? { detail: evidence.detail } : {})
  };
}

function createFeedbackButtons(input: {
  occurrenceId: string;
  occurrenceType: OccurrenceFeedbackType;
  source?: string;
  startSeconds: number;
  summary: string;
  reason?: string;
}): HTMLButtonElement[] {
  return OCCURRENCE_FEEDBACK_ACTIONS.map((action) => createFeedbackButton(action, input));
}

function createFeedbackButton(
  action: OccurrenceFeedbackAction,
  input: {
    occurrenceId: string;
    occurrenceType: OccurrenceFeedbackType;
    source?: string;
    startSeconds: number;
    summary: string;
    reason?: string;
  }
): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'feedback-action';
  button.textContent = action.label;
  button.title = action.title;
  button.setAttribute('aria-label', `${action.label} - ${action.title}`);
  button.dataset.feedback = action.value;
  button.dataset.occurrenceId = input.occurrenceId;
  button.dataset.occurrenceType = input.occurrenceType;
  button.dataset.startSeconds = String(input.startSeconds);
  button.dataset.summary = input.summary;
  if (input.source) button.dataset.source = input.source;
  if (input.reason) button.dataset.reason = input.reason;
  return button;
}

function getActiveTabId(): Promise<number> {
  return new Promise((resolve, reject) => {
    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      if (tab?.id === undefined) {
        reject(new Error('No active browser tab found.'));
        return;
      }
      resolve(tab.id);
    });
  });
}

function sendSeekMessage(tabId: number, seconds: number): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, { type: seekToMessageType, seconds }, (response?: { ok: boolean; error?: string }) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve(response ?? { ok: false, error: 'No response from YouTube tab.' });
    });
  });
}

function sendFastScanMessage(tabId: number, enabled: boolean, intervalSeconds: number): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(
      tabId,
      { type: fastScanMessageType, enabled, intervalSeconds },
      (response?: { ok: boolean; error?: string }) => {
        const error = chrome.runtime.lastError;
        if (error) {
          reject(new Error(error.message));
          return;
        }
        resolve(response ?? { ok: false, error: 'No response from YouTube tab.' });
      }
    );
  });
}

function clampIntervalSeconds(value: number): number {
  if (!Number.isFinite(value)) return 2;
  return Math.min(5, Math.max(1, Math.round(value)));
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

function removeLocalStorageValue(key: string): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.remove(key, () => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve();
    });
  });
}
