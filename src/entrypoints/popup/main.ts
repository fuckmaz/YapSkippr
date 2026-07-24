import './style.css';
import {
  AUTO_SKIP_ENABLED_STORAGE_KEY,
  CLIENT_ID_STORAGE_KEY,
  FEEDBACK_CONSENT_STORAGE_KEY,
  FEEDBACK_ENDPOINT_STORAGE_KEY,
  TRANSCRIPT_PHRASE_GROUPS_STORAGE_KEY
} from '../../core/extension-settings';
import {
  createFeedbackDataCollectionPermissionRequest,
  evaluateFeedbackAuthorization,
  isFirefoxExtensionUrl,
  removesFeedbackDataCollectionPermission,
  type FeedbackAuthorization,
  type FeedbackDataCollectionPermissionRequest
} from '../../core/feedback-consent';
import {
  createFeedbackSendControl,
  isFeedbackSendInvalidatedError,
  type FeedbackSendLease
} from '../../core/feedback-send-control';
import {
  DEFAULT_TRANSCRIPT_PHRASE_GROUPS,
  formatTranscriptPhraseGroupsForEditing,
  parseTranscriptPhraseGroups,
  parseTranscriptPhraseGroupsJson
} from '../../core/analysis/transcript-analyzer';
import {
  OCCURRENCE_FEEDBACK_ACTIONS,
  createFeedbackEndpointOriginPermission,
  createOccurrenceFeedbackPayload,
  deriveAdminDashboardUrl,
  normalizeFeedbackEndpoint,
  type OccurrenceFeedbackAction,
  type OccurrenceFeedbackValue,
  type OccurrenceFeedbackType
} from '../../core/feedback';
import { createIdleScanStatus, type ScanStatusEvidence, type ScanStatusSnapshot } from '../../core/scan-status';
import {
  formatFeedbackTimecode,
  MAX_MISSED_SEGMENT_DURATION_SECONDS,
  parseFeedbackTimecode
} from '../../core/missed-segment';
import {
  createScanCapabilityController,
  createScanCapabilitySessionKey
} from '../../core/scan-capability-controller';
import {
  isValidScanStatusTabId,
  readStoredScanStatus,
  subscribeToStoredScanStatus
} from '../../core/scan-status-storage';
import {
  createPopupScanStatusView,
  type PopupCandidateView,
  type PopupEvidenceEventView
} from '../../ui/popup-scan-status-view';
import { createStableListRenderer } from '../../ui/stable-list-renderer';
import { getYouTubeVideoIdFromUrl, isYouTubeWatchUrl } from '../../platform/youtube/youtube-url';

const frameCaptureOrigins = ['<all_urls>'];
const seekToMessageType = 'YAPSKIPPR_SEEK_TO';
const fastScanMessageType = 'YAPSKIPPR_SET_FAST_SCAN';
const scanCapabilityMessageType = 'YAPSKIPPR_GET_SCAN_CAPABILITY';
const missedSegmentContextMessageType = 'YAPSKIPPR_GET_MISSED_SEGMENT_CONTEXT';
const status = document.querySelector('#status');
const basicModeToggle = document.querySelector<HTMLButtonElement>('#basic-mode-toggle');
const detailedModeToggle = document.querySelector<HTMLButtonElement>('#detailed-mode-toggle');
const basicView = document.querySelector<HTMLElement>('#basic-view');
const permissionPanel = document.querySelector<HTMLElement>('#permission-panel');
const permissionTitle = document.querySelector('#permission-title');
const permissionStatus = document.querySelector('#permission-status');
const grantAccessButton = document.querySelector<HTMLButtonElement>('#grant-access');
const scanTitle = document.querySelector('#scan-title');
const scanPhase = document.querySelector('#scan-phase');
const scanMessage = document.querySelector('#scan-message');
const scanProgressText = document.querySelector('#scan-progress-text');
const scanMeter = document.querySelector<HTMLElement>('.scan-meter');
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
const autoSkipToggle = document.querySelector<HTMLButtonElement>('#auto-skip-toggle');
const autoSkipStatus = document.querySelector('#auto-skip-status');
const candidateResults = document.querySelector<HTMLElement>('#candidate-results');
const scanCandidates = document.querySelector<HTMLOListElement>('#scan-candidates');
const candidateActionStatus = document.querySelector('#candidate-action-status');
const missedSegmentToggle = document.querySelector<HTMLButtonElement>('#missed-segment-toggle');
const missedSegmentForm = document.querySelector<HTMLFormElement>('#missed-segment-form');
const missedSegmentStart = document.querySelector<HTMLInputElement>('#missed-segment-start');
const missedSegmentEnd = document.querySelector<HTMLInputElement>('#missed-segment-end');
const missedSegmentCancel = document.querySelector<HTMLButtonElement>('#missed-segment-cancel');
const missedSegmentSubmit = document.querySelector<HTMLButtonElement>('#missed-segment-submit');
const missedSegmentStatus = document.querySelector('#missed-segment-status');
const activityPanel = document.querySelector<HTMLElement>('.activity-panel');
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
const feedbackConsentPanel = document.querySelector<HTMLElement>('#feedback-consent-panel');
const feedbackConsentInput = document.querySelector<HTMLInputElement>('#feedback-consent');
const feedbackConsentStatus = document.querySelector('#feedback-consent-status');
const feedbackEndpointInput = document.querySelector<HTMLInputElement>('#feedback-endpoint');
const saveFeedbackEndpointButton = document.querySelector<HTMLButtonElement>('#save-feedback-endpoint');
const adminDashboardLink = document.querySelector<HTMLAnchorElement>('#admin-dashboard-link');
const feedbackStatus = document.querySelector('#feedback-status');
const transcriptPhraseGroupsInput = document.querySelector<HTMLTextAreaElement>('#transcript-phrase-groups');
const saveTranscriptPhraseGroupsButton = document.querySelector<HTMLButtonElement>('#save-transcript-phrase-groups');
const resetTranscriptPhraseGroupsButton = document.querySelector<HTMLButtonElement>('#reset-transcript-phrase-groups');
const transcriptPhraseStatus = document.querySelector('#transcript-phrase-status');
const scanEvidenceEvents = document.querySelector<HTMLOListElement>('#scan-evidence-events');
const signalDetailsPanel = document.querySelector<HTMLElement>('#signal-details-panel');
const scanUpdated = document.querySelector('#scan-updated');
const scanCandidateListRenderer = scanCandidates
  ? createStableListRenderer<PopupCandidateView, HTMLLIElement>({
      target: scanCandidates,
      fingerprint: (candidate) => [
        candidate.id,
        candidate.summary,
        candidate.detail,
        candidate.feedbackSummary,
        candidate.feedbackReason,
        candidate.seekSeconds,
        candidate.endSeconds ?? null,
        candidate.actionLabel
      ],
      createNode: createCandidateListItem
    })
  : null;
const scanEvidenceListRenderer = scanEvidenceEvents
  ? createStableListRenderer<PopupEvidenceEventView, HTMLLIElement>({
      target: scanEvidenceEvents,
      fingerprint: (evidence) => [
        evidence.id,
        evidence.sourceLabel,
        evidence.kindLabel,
        evidence.timeLabel,
        evidence.startSeconds,
        evidence.confidenceText,
        evidence.reason,
        evidence.detail ?? null
      ],
      createNode: createEvidenceListItem
    })
  : null;
let currentScanStatus: ScanStatusSnapshot = createIdleScanStatus();
let ownedTabId: number | null = null;
let activeWatchVideoId: string | null = null;
let stopScanStatusSubscription: (() => void) | undefined;
let autoSkipPreferenceGeneration = 0;
let anonymousClientIdPromise: Promise<string | null> | null = null;
const feedbackSendControl = createFeedbackSendControl();
const fastScanCapability = createScanCapabilityController({
  probe: sendScanCapabilityMessage,
  render(view) {
    if (view.enabled) fastScanToggle?.removeAttribute('disabled');
    else fastScanToggle?.setAttribute('disabled', 'true');
    if (view.message) setFastScanStatus(view.message);
  }
});

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

autoSkipToggle?.addEventListener('click', () => {
  void saveAutoSkipPreference(autoSkipToggle.dataset.enabled !== 'true');
});

missedSegmentToggle?.addEventListener('click', () => {
  setMissedSegmentFormOpen(missedSegmentForm?.hidden !== false);
});
missedSegmentCancel?.addEventListener('click', () => setMissedSegmentFormOpen(false));
missedSegmentForm?.addEventListener('submit', (event) => {
  event.preventDefault();
  void submitMissedSegment();
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

feedbackConsentInput?.addEventListener('change', () => {
  void updateFeedbackConsent(feedbackConsentInput.checked);
});

saveTranscriptPhraseGroupsButton?.addEventListener('click', () => {
  void saveTranscriptPhraseGroups();
});

resetTranscriptPhraseGroupsButton?.addEventListener('click', () => {
  void resetTranscriptPhraseGroups();
});

renderScanStatus(createIdleScanStatus());
chrome.storage.onChanged.addListener(handleFeedbackStorageChanged);
const stopFeedbackPermissionRemovalSubscription = subscribeToFeedbackPermissionRemovals();
void initializeScanStatus();
void loadFeedbackConsent();
void loadFeedbackEndpoint();
void loadAutoSkipPreference();
void loadTranscriptPhraseGroups();
window.addEventListener('pagehide', () => {
  stopScanStatusSubscription?.();
  chrome.storage.onChanged.removeListener(handleFeedbackStorageChanged);
  stopFeedbackPermissionRemovalSubscription();
  feedbackSendControl.dispose();
  fastScanCapability.dispose();
}, { once: true });


async function initializeScanStatus(): Promise<void> {
  try {
    const activeTab = await getActiveTab();
    activeWatchVideoId = getYouTubeWatchVideoId(activeTab.url);
    if (!activeWatchVideoId) {
      ownedTabId = null;
      permissionPanel?.setAttribute('hidden', 'true');
      status?.replaceChildren(document.createTextNode('Open a YouTube video to use YapSkippr.'));
      renderScanStatus(createIdleScanStatus());
      fastScanToggle?.setAttribute('disabled', 'true');
      return;
    }

    const tabId = activeTab.id;
    ownedTabId = tabId;
    status?.replaceChildren(document.createTextNode('Watching this YouTube video for ad reads.'));
    void refreshFrameCaptureAccess();

    let receivedSubscriptionUpdate = false;
    stopScanStatusSubscription = subscribeToStoredScanStatus(tabId, (statusSnapshot) => {
      receivedSubscriptionUpdate = true;
      const relevantStatus = getRelevantScanStatus(statusSnapshot);
      renderScanStatus(relevantStatus);
      refreshFastScanCapability(tabId, relevantStatus);
    });

    const storedStatus = getRelevantScanStatus(await readStoredScanStatus(tabId));
    if (!receivedSubscriptionUpdate) {
      renderScanStatus(storedStatus);
      refreshFastScanCapability(tabId, storedStatus);
    }
  } catch (error) {
    ownedTabId = null;
    activeWatchVideoId = null;
    stopScanStatusSubscription?.();
    stopScanStatusSubscription = undefined;
    fastScanCapability.dispose();
    permissionPanel?.setAttribute('hidden', 'true');
    status?.replaceChildren(document.createTextNode('Open a YouTube video to use YapSkippr.'));
    const message = error instanceof Error ? error.message : String(error);
    renderScanStatus(createIdleScanStatus());
    fastScanToggle?.setAttribute('disabled', 'true');
    scanMessage?.replaceChildren(document.createTextNode(`Could not resolve this tab's scan status: ${message}`));
  }
}

function renderScanStatus(statusSnapshot = createIdleScanStatus()): void {
  currentScanStatus = statusSnapshot;
  const view = createPopupScanStatusView(statusSnapshot);

  scanTitle?.replaceChildren(document.createTextNode(view.title));
  scanPhase?.replaceChildren(document.createTextNode(view.phaseLabel));
  if (scanPhase instanceof HTMLElement) scanPhase.dataset.phase = statusSnapshot.phase;
  scanMessage?.replaceChildren(document.createTextNode(view.message));
  scanProgressText?.replaceChildren(document.createTextNode(view.progressText));
  scanMeter?.setAttribute('aria-valuenow', String(view.progressPercent));
  scanProgressBar?.style.setProperty('width', view.progressText);
  scanTime?.replaceChildren(document.createTextNode(view.videoTimeText));
  scanSamples?.replaceChildren(document.createTextNode(view.sampleCountText));
  scanCandidateCount?.replaceChildren(document.createTextNode(view.candidateCountText));
  evidenceTranscript?.replaceChildren(document.createTextNode(view.evidenceItems[0]?.value ?? '0'));
  evidenceProgress?.replaceChildren(document.createTextNode(view.evidenceItems[1]?.value ?? '0'));
  evidenceQr?.replaceChildren(document.createTextNode(view.evidenceItems[2]?.value ?? '0'));
  evidenceLinks?.replaceChildren(document.createTextNode(view.evidenceItems[3]?.value ?? '0'));
  fastScanStatus?.replaceChildren(document.createTextNode(view.fastScanText));
  fastScanToggle?.replaceChildren(document.createTextNode(
    statusSnapshot.fastScanEnabled ? 'Use standard 5s interval' : 'Use selected interval'
  ));
  if (fastScanToggle) fastScanToggle.dataset.enabled = String(statusSnapshot.fastScanEnabled);
  if (fastScanInterval && document.activeElement !== fastScanInterval) {
    fastScanInterval.value = String(statusSnapshot.fastScanIntervalSeconds);
  }
  scanUpdated?.replaceChildren(document.createTextNode(view.updatedText));

  scanCandidateListRenderer?.render(view.candidates);
  if (candidateResults) candidateResults.hidden = view.candidates.length === 0;

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
  if (activityPanel) activityPanel.hidden = view.events.length === 0;

  detailVideoId?.replaceChildren(document.createTextNode(statusSnapshot.videoId ?? '-'));
  detailPageUrl?.replaceChildren(document.createTextNode(statusSnapshot.pageUrl ?? '-'));
  detailTotalEvidence?.replaceChildren(document.createTextNode(String(statusSnapshot.evidenceCounts.total)));
  detailModel?.replaceChildren(document.createTextNode(view.modelText));
  detailModelSource?.replaceChildren(document.createTextNode(statusSnapshot.model.modelSource));
  detailModelSchema?.replaceChildren(document.createTextNode(statusSnapshot.model.featureSchemaVersion === null ? '-' : String(statusSnapshot.model.featureSchemaVersion)));
  detailModelMessage?.replaceChildren(document.createTextNode(statusSnapshot.model.message));
  detailUpdated?.replaceChildren(document.createTextNode(view.updatedText));
  scanEvidenceListRenderer?.render(view.evidenceEvents);
  if (signalDetailsPanel) signalDetailsPanel.hidden = view.evidenceEvents.length === 0;
}

function createCandidateListItem(candidate: PopupCandidateView): HTMLLIElement {
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
    endSeconds: candidate.endSeconds,
    summary: candidate.feedbackSummary,
    reason: candidate.feedbackReason
  }));
  item.append(copy, actions);
  return item;
}

function createEvidenceListItem(evidence: PopupEvidenceEventView): HTMLLIElement {
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
}

async function refreshFrameCaptureAccess(): Promise<void> {
  renderPermissionState({
    hidden: false,
    title: 'Enable visual checks',
    status: 'Checking access...',
    buttonHidden: false,
    buttonDisabled: true
  });

  try {
    const granted = await containsFrameCaptureAccess();
    if (granted) {
      renderPermissionState({
        hidden: true,
        title: 'Visual checks enabled',
        status: 'Visual checks are enabled.',
        buttonHidden: true,
        buttonDisabled: true
      });
      return;
    }
    renderPermissionNeedsAccess();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    renderPermissionState({
      hidden: false,
      title: 'Enable visual checks',
      status: `Could not check access: ${message}`,
      buttonHidden: false,
      buttonDisabled: false
    });
  }
}

async function requestFrameCaptureAccess(): Promise<void> {
  renderPermissionState({
    hidden: false,
    title: 'Enable visual checks',
    status: 'Requesting access for all websites...',
    buttonHidden: false,
    buttonDisabled: true
  });

  try {
    const granted = await requestPermissions({ origins: frameCaptureOrigins });
    if (granted) {
      renderPermissionState({
        hidden: false,
        title: 'Visual checks enabled',
        status: 'Access granted. Reload the YouTube tab to start visual checks.',
        buttonHidden: true,
        buttonDisabled: true
      });
      if (permissionStatus instanceof HTMLElement) permissionStatus.focus();
      return;
    }
    renderPermissionNeedsAccess('Access was not granted. Visual checks remain off; you can continue without them.');
    grantAccessButton?.focus();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    renderPermissionState({
      hidden: false,
      title: 'Enable visual checks',
      status: `Access request failed: ${message}`,
      buttonHidden: false,
      buttonDisabled: false
    });
    grantAccessButton?.focus();
  }
}

function renderPermissionNeedsAccess(
  message = 'Visual checks are off until access is allowed.'
): void {
  renderPermissionState({
    hidden: false,
    title: 'Enable visual checks',
    status: message,
    buttonHidden: false,
    buttonDisabled: false
  });
}

function renderPermissionState(view: {
  hidden: boolean;
  title: string;
  status: string;
  buttonHidden: boolean;
  buttonDisabled: boolean;
}): void {
  if (permissionPanel) permissionPanel.hidden = view.hidden;
  permissionTitle?.replaceChildren(document.createTextNode(view.title));
  permissionStatus?.replaceChildren(document.createTextNode(view.status));
  if (grantAccessButton) {
    grantAccessButton.hidden = view.buttonHidden;
    grantAccessButton.disabled = view.buttonDisabled;
  }
}

function containsFrameCaptureAccess(): Promise<boolean> {
  return containsPermissions({ origins: frameCaptureOrigins });
}

function containsPermissions(permissions: chrome.permissions.Permissions): Promise<boolean> {
  return new Promise((resolve, reject) => {
    chrome.permissions.contains(permissions, (result) => {
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
    const tabId = getOwnedTabId();
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
  setFastScanStatus(enabled ? 'Applying the selected visual-check interval...' : 'Restoring the standard 5s interval...');

  try {
    const tabId = getOwnedTabId();
    const response = await sendFastScanMessage(tabId, enabled, safeIntervalSeconds);
    if (!response.ok) {
      throw new Error(response.error ?? 'YouTube tab did not accept the visual-check interval.');
    }
    setFastScanStatus(enabled ? `Visual checks · every ${safeIntervalSeconds}s` : 'Standard visual checks · every 5s');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setFastScanStatus(`Could not change the visual-check interval: ${message}`);
  }
}

function refreshFastScanCapability(tabId: number, scanStatus: ScanStatusSnapshot): void {
  fastScanCapability.update({
    tabId,
    sessionKey: createScanCapabilitySessionKey({
      tabId,
      platformId: scanStatus.platformId,
      videoId: scanStatus.videoId,
      pageUrl: scanStatus.pageUrl
    }),
    phase: scanStatus.phase
  });
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

function setMissedSegmentStatus(message: string): void {
  missedSegmentStatus?.replaceChildren(document.createTextNode(message));
}

function setFeedbackConsentStatus(message: string): void {
  feedbackConsentStatus?.replaceChildren(document.createTextNode(message));
}

function setAutoSkipStatus(message: string): void {
  autoSkipStatus?.replaceChildren(document.createTextNode(message));
}

function handleFeedbackStorageChanged(
  changes: Record<string, chrome.storage.StorageChange>,
  areaName: string
): void {
  if (areaName !== 'local') return;

  const autoSkipChange = changes[AUTO_SKIP_ENABLED_STORAGE_KEY];
  if (autoSkipChange) {
    autoSkipPreferenceGeneration += 1;
    renderAutoSkipPreference(autoSkipChange.newValue === true);
  }

  const consentChange = changes[FEEDBACK_CONSENT_STORAGE_KEY];
  if (consentChange) {
    if (consentChange.newValue !== true) {
      revokeFeedbackAuthorization(
        'Feedback sharing was turned off in extension storage.',
        'Feedback send cancelled because sharing was turned off.'
      );
    } else {
      void synchronizeFeedbackAuthorization();
    }
  }

  const endpointChange = changes[FEEDBACK_ENDPOINT_STORAGE_KEY];
  if (endpointChange) {
    const endpoint = typeof endpointChange.newValue === 'string'
      ? normalizeFeedbackEndpoint(endpointChange.newValue)
      : null;
    const changed = feedbackSendControl.setEndpoint(endpoint);
    if (feedbackEndpointInput) feedbackEndpointInput.value = endpoint ?? '';
    updateAdminDashboardLink(endpoint);
    const generation = feedbackSendControl.getEndpointGeneration();
    void refreshFeedbackEndpointAccessView(endpoint, generation, changed);
  }
}

async function loadAutoSkipPreference(): Promise<void> {
  autoSkipToggle?.setAttribute('disabled', 'true');
  const generation = autoSkipPreferenceGeneration;
  try {
    const value = await getLocalStorageValue(AUTO_SKIP_ENABLED_STORAGE_KEY);
    if (generation !== autoSkipPreferenceGeneration) return;
    renderAutoSkipPreference(value === true);
  } catch (error) {
    if (generation !== autoSkipPreferenceGeneration) return;
    const message = error instanceof Error ? error.message : String(error);
    renderAutoSkipPreference(false, `Auto-skip stays off because its setting could not be loaded: ${message}`);
  } finally {
    autoSkipToggle?.removeAttribute('disabled');
  }
}

async function saveAutoSkipPreference(enabled: boolean): Promise<void> {
  autoSkipToggle?.setAttribute('disabled', 'true');
  const generation = ++autoSkipPreferenceGeneration;
  setAutoSkipStatus(enabled ? 'Turning auto-skip on...' : 'Turning auto-skip off...');

  try {
    await setLocalStorageValue(AUTO_SKIP_ENABLED_STORAGE_KEY, enabled);
    if (generation !== autoSkipPreferenceGeneration) return;
    renderAutoSkipPreference(enabled);
  } catch (error) {
    if (generation !== autoSkipPreferenceGeneration) return;
    const previousEnabled = autoSkipToggle?.dataset.enabled === 'true';
    const message = error instanceof Error ? error.message : String(error);
    renderAutoSkipPreference(previousEnabled, `Could not save auto-skip setting: ${message}`);
  } finally {
    autoSkipToggle?.removeAttribute('disabled');
  }
}

function renderAutoSkipPreference(enabled: boolean, statusMessage?: string): void {
  if (autoSkipToggle) {
    autoSkipToggle.dataset.enabled = String(enabled);
    autoSkipToggle.textContent = enabled ? 'Turn off' : 'Turn on';
    autoSkipToggle.setAttribute('aria-pressed', String(enabled));
  }
  setAutoSkipStatus(statusMessage ?? (enabled
    ? 'Auto-skip is on. Undo is available beside the YouTube player after every skip.'
    : 'Auto-skip is off. Detection and jump actions still work normally.'));
}

function subscribeToFeedbackPermissionRemovals(): () => void {
  if (!isFirefoxRuntime()) return () => undefined;
  const event = getFeedbackPermissionsApi().onRemoved;
  const listener = (permissions: unknown) => {
    if (!removesFeedbackDataCollectionPermission(permissions)) return;
    revokeFeedbackAuthorization(
      'Feedback sharing is off because its Firefox data permission was removed.',
      'Feedback send cancelled because Firefox permission was removed.'
    );
  };
  event.addListener(listener);
  return () => event.removeListener(listener);
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
  if (basicView) basicView.hidden = enabled;
  if (developerPanel) developerPanel.hidden = !enabled;
  if (basicModeToggle) {
    basicModeToggle.dataset.active = String(!enabled);
    basicModeToggle.setAttribute('aria-pressed', String(!enabled));
  }
  if (detailedModeToggle) {
    detailedModeToggle.dataset.active = String(enabled);
    detailedModeToggle.setAttribute('aria-pressed', String(enabled));
  }
  window.scrollTo(0, 0);
}

async function loadFeedbackEndpoint(): Promise<void> {
  const loadGeneration = feedbackSendControl.getEndpointGeneration();
  try {
    const value = await getLocalStorageValue(FEEDBACK_ENDPOINT_STORAGE_KEY);
    if (!feedbackSendControl.isEndpointGenerationCurrent(loadGeneration)) return;
    const endpoint = typeof value === 'string' ? normalizeFeedbackEndpoint(value) : null;
    if (!feedbackSendControl.setEndpointIfCurrent(loadGeneration, endpoint)) return;
    if (feedbackEndpointInput) feedbackEndpointInput.value = endpoint ?? '';
    updateAdminDashboardLink(endpoint);
    await refreshFeedbackEndpointAccessView(
      endpoint,
      feedbackSendControl.getEndpointGeneration(),
      false
    );
  } catch (error) {
    if (!feedbackSendControl.isEndpointGenerationCurrent(loadGeneration)) return;
    const message = error instanceof Error ? error.message : String(error);
    updateAdminDashboardLink(null);
    setFeedbackStatus(`Could not load feedback endpoint: ${message}`);
  }
}

async function loadFeedbackConsent(): Promise<void> {
  if (feedbackConsentInput) feedbackConsentInput.disabled = true;
  const generation = feedbackSendControl.getConsentGeneration();

  try {
    const authorization = await readFeedbackAuthorization();
    applyFeedbackAuthorization(generation, authorization);
  } catch (error) {
    if (feedbackSendControl.getConsentGeneration() !== generation) return;
    const message = error instanceof Error ? error.message : String(error);
    revokeFeedbackAuthorization(`Feedback sharing is off because consent could not be verified: ${message}`);
  } finally {
    if (feedbackConsentInput) feedbackConsentInput.disabled = false;
  }
}

async function updateFeedbackConsent(enabled: boolean): Promise<void> {
  if (feedbackConsentInput) feedbackConsentInput.disabled = true;
  if (feedbackConsentPanel) delete feedbackConsentPanel.dataset.attention;

  if (!enabled) {
    revokeFeedbackAuthorization(
      'Feedback sharing is off.',
      'Feedback send cancelled because sharing was turned off.'
    );
    try {
      await setLocalStorageValue(FEEDBACK_CONSENT_STORAGE_KEY, false);
      if (isFirefoxRuntime()) {
        try {
          await removeFeedbackDataCollectionPermission();
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          setFeedbackConsentStatus(`Feedback sharing is off. Firefox permission removal failed: ${message}`);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setFeedbackConsentStatus(`Feedback sharing is off locally, but the setting could not be saved: ${message}`);
    } finally {
      if (feedbackConsentInput) feedbackConsentInput.disabled = false;
    }
    return;
  }

  const generation = feedbackSendControl.getConsentGeneration();
  let requestedFirefoxPermission = false;
  try {
    if (isFirefoxRuntime()) {
      requestedFirefoxPermission = await requestFeedbackDataCollectionPermission();
      if (feedbackSendControl.getConsentGeneration() !== generation) {
        if (requestedFirefoxPermission) await removeFeedbackDataCollectionPermission().catch(() => undefined);
        return;
      }
      if (!requestedFirefoxPermission) {
        await setLocalStorageValue(FEEDBACK_CONSENT_STORAGE_KEY, false);
        revokeFeedbackAuthorization('Feedback sharing remains off because Firefox permission was not granted.');
        return;
      }
    }

    await setLocalStorageValue(FEEDBACK_CONSENT_STORAGE_KEY, true);
    if (feedbackSendControl.getConsentGeneration() !== generation) {
      if (requestedFirefoxPermission) await removeFeedbackDataCollectionPermission().catch(() => undefined);
      return;
    }

    const authorization = await readFeedbackAuthorization();
    applyFeedbackAuthorization(generation, authorization);
  } catch (error) {
    if (requestedFirefoxPermission) await removeFeedbackDataCollectionPermission().catch(() => undefined);
    if (feedbackSendControl.getConsentGeneration() !== generation) return;
    feedbackSendControl.revokeConsent();
    await setLocalStorageValue(FEEDBACK_CONSENT_STORAGE_KEY, false).catch(() => undefined);
    const message = error instanceof Error ? error.message : String(error);
    setFeedbackConsentStatus(`Could not update feedback sharing: ${message}`);
    if (feedbackConsentInput) feedbackConsentInput.checked = false;
  } finally {
    if (feedbackConsentInput) feedbackConsentInput.disabled = false;
  }
}

async function saveFeedbackEndpoint(): Promise<void> {
  const rawValue = feedbackEndpointInput?.value.trim() ?? '';
  const normalized = normalizeFeedbackEndpoint(rawValue);
  if (!normalized) {
    if (rawValue) {
      setFeedbackStatus('Use HTTPS without embedded credentials. Loopback HTTP is allowed only for localhost, 127.0.0.1, or [::1].');
      return;
    }

    const previousEndpoint = feedbackSendControl.getEndpoint();
    feedbackSendControl.invalidateEndpoint();
    const generation = feedbackSendControl.getEndpointGeneration();
    updateAdminDashboardLink(null);
    setFeedbackStatus('Clearing feedback endpoint...');
    try {
      await setLocalStorageValue(FEEDBACK_ENDPOINT_STORAGE_KEY, '');
      if (!feedbackSendControl.isEndpointGenerationCurrent(generation)) return;
      setFeedbackStatus('No feedback endpoint saved.');
    } catch (error) {
      if (!feedbackSendControl.isEndpointGenerationCurrent(generation)) return;
      feedbackSendControl.setEndpoint(previousEndpoint);
      updateAdminDashboardLink(previousEndpoint);
      const message = error instanceof Error ? error.message : String(error);
      setFeedbackStatus(`Could not clear feedback endpoint: ${message}`);
    }
    return;
  }

  const previousEndpoint = feedbackSendControl.getEndpoint();
  if (previousEndpoint !== normalized) feedbackSendControl.invalidateEndpoint();
  const generation = feedbackSendControl.getEndpointGeneration();
  if (feedbackEndpointInput) feedbackEndpointInput.value = normalized;
  updateAdminDashboardLink(normalized);
  saveFeedbackEndpointButton?.setAttribute('disabled', 'true');
  setFeedbackStatus('Requesting access to the feedback endpoint...');

  try {
    const granted = await requestFeedbackEndpointAccess(normalized);
    if (!feedbackSendControl.isEndpointGenerationCurrent(generation)) return;
    if (!granted) {
      feedbackSendControl.setEndpoint(previousEndpoint);
      updateAdminDashboardLink(previousEndpoint);
      setFeedbackStatus('Endpoint was not saved because access to its origin was not granted.');
      return;
    }

    await setLocalStorageValue(FEEDBACK_ENDPOINT_STORAGE_KEY, normalized);
    if (!feedbackSendControl.isEndpointGenerationCurrent(generation)) return;
    feedbackSendControl.setEndpoint(normalized);
    updateAdminDashboardLink(normalized);
    setFeedbackStatus('Feedback endpoint saved with origin access. Sharing follows the switch above.');
  } catch (error) {
    if (!feedbackSendControl.isEndpointGenerationCurrent(generation)) return;
    feedbackSendControl.setEndpoint(previousEndpoint);
    updateAdminDashboardLink(previousEndpoint);
    const message = error instanceof Error ? error.message : String(error);
    setFeedbackStatus(`Could not save feedback endpoint: ${message}`);
  } finally {
    saveFeedbackEndpointButton?.removeAttribute('disabled');
  }
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

type FeedbackPayloadInput = Parameters<typeof createOccurrenceFeedbackPayload>[0];
type MissedSegmentContextResponse = {
  ok: boolean;
  error?: string;
} & Partial<Pick<
  FeedbackPayloadInput,
  | 'modelId'
  | 'modelVersion'
  | 'modelSource'
  | 'featureSchemaVersion'
  | 'heuristicConfidence'
  | 'modelConfidence'
  | 'candidateFeatures'
  | 'evidenceSnapshot'
  | 'transcriptContext'
>>;

function setMissedSegmentFormOpen(open: boolean): void {
  if (!missedSegmentForm || !missedSegmentToggle) return;
  missedSegmentForm.hidden = !open;
  missedSegmentToggle.setAttribute('aria-expanded', String(open));
  missedSegmentToggle.textContent = open ? 'Close' : 'Report';
  if (!open) return;

  const currentTime = currentScanStatus.videoCurrentTimeSeconds ?? 0;
  if (missedSegmentStart && !missedSegmentStart.value) {
    missedSegmentStart.value = formatFeedbackTimecode(Math.max(0, currentTime - 30));
  }
  if (missedSegmentEnd && !missedSegmentEnd.value) {
    missedSegmentEnd.value = formatFeedbackTimecode(currentTime);
  }
  setMissedSegmentStatus('Adjust the start and end, then send.');
  missedSegmentStart?.focus();
}

async function submitMissedSegment(): Promise<void> {
  const startSeconds = parseFeedbackTimecode(missedSegmentStart?.value ?? '');
  const endSeconds = parseFeedbackTimecode(missedSegmentEnd?.value ?? '');
  const durationSeconds = currentScanStatus.videoDurationSeconds;
  if (
    startSeconds === null
    || endSeconds === null
    || endSeconds <= startSeconds
    || endSeconds - startSeconds > MAX_MISSED_SEGMENT_DURATION_SECONDS
    || (durationSeconds !== null && endSeconds > durationSeconds + 1)
  ) {
    setMissedSegmentStatus('Enter a valid segment up to 10 minutes long.');
    missedSegmentStart?.focus();
    return;
  }
  if (!currentScanStatus.videoId || !currentScanStatus.pageUrl) {
    setMissedSegmentStatus('Open a scanned YouTube video before reporting a missed segment.');
    return;
  }

  missedSegmentSubmit?.setAttribute('disabled', 'true');
  setMissedSegmentStatus('Capturing detector context...');
  try {
    const response = await sendMissedSegmentContextMessage(getOwnedTabId(), startSeconds, endSeconds);
    if (!response.ok) throw new Error(response.error ?? 'The YouTube tab could not capture this segment.');
    const { ok: _ok, error: _error, ...context } = response;
    const outcome = await sendFeedbackPayload({
      videoUrl: currentScanStatus.pageUrl,
      videoId: currentScanStatus.videoId,
      occurrenceId: `missed-${currentScanStatus.videoId}-${Math.round(startSeconds * 10)}-${Math.round(endSeconds * 10)}`,
      occurrenceType: 'missed-segment',
      source: 'user-missed-segment',
      startSeconds,
      endSeconds,
      summary: `${formatFeedbackTimecode(startSeconds)}-${formatFeedbackTimecode(endSeconds)} · manually reported missed ad read`,
      reason: 'Viewer marked an ad-read segment that YapSkippr did not detect.',
      feedback: 'missed_context',
      ...context
    }, missedSegmentSubmit, setMissedSegmentStatus);
    if (outcome) {
      if (missedSegmentStart) missedSegmentStart.value = '';
      if (missedSegmentEnd) missedSegmentEnd.value = '';
      setMissedSegmentFormOpen(false);
      setMissedSegmentStatus(
        outcome === 'deduplicated'
          ? 'This missed segment was already received.'
          : 'Missed segment sent. Thank you.'
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setMissedSegmentStatus(`Could not send segment: ${message}`);
  } finally {
    missedSegmentSubmit?.removeAttribute('disabled');
  }
}

async function sendFeedbackForButton(button: HTMLButtonElement): Promise<void> {
  const startSeconds = Number(button.dataset.startSeconds);
  const feedback = button.dataset.feedback as OccurrenceFeedbackValue | undefined;
  const occurrenceType = button.dataset.occurrenceType as OccurrenceFeedbackType | undefined;
  if (!Number.isFinite(startSeconds) || !feedback || !occurrenceType) {
    setFeedbackStatus('Feedback target is missing required occurrence data.');
    return;
  }

  const occurrenceId = button.dataset.occurrenceId ?? 'unknown';
  const endSeconds = Number(button.dataset.endSeconds);
  await sendFeedbackPayload({
    videoUrl: currentScanStatus.pageUrl,
    videoId: currentScanStatus.videoId,
    occurrenceId,
    occurrenceType,
    source: button.dataset.source,
    startSeconds,
    ...(Number.isFinite(endSeconds) ? { endSeconds } : {}),
    summary: button.dataset.summary ?? 'YapSkippr occurrence',
    reason: button.dataset.reason,
    feedback,
    ...getFeedbackContext(currentScanStatus, occurrenceId, occurrenceType)
  }, button, setFeedbackStatus);
}

async function sendFeedbackPayload(
  input: FeedbackPayloadInput,
  trigger: HTMLButtonElement | null,
  setStatus: (message: string) => void
): Promise<'created' | 'deduplicated' | null> {
  if (!feedbackSendControl.isAuthorized()) {
    setStatus('Feedback sharing is off. Turn it on before sending a report.');
    presentFeedbackConsentRequired('Feedback sharing is off. Turn it on before sending a report.');
    return null;
  }
  if (!feedbackSendControl.getEndpoint()) {
    setStatus('Set and save a feedback API endpoint in Advanced first.');
    setFeedbackStatus('Set and save a feedback API endpoint in Advanced first.');
    setDetailedMode(true);
    feedbackEndpointInput?.focus();
    return null;
  }

  const payloadSnapshot = JSON.stringify(createOccurrenceFeedbackPayload(input, Date.now()));
  const lease = feedbackSendControl.begin();
  if (!lease) {
    setStatus('Feedback sharing changed before the report could start.');
    presentFeedbackConsentRequired('Feedback sharing changed before the report could start.');
    return null;
  }

  if (trigger) trigger.disabled = true;
  setStatus('Sending feedback...');

  try {
    const authorization = await readFeedbackAuthorization();
    feedbackSendControl.assertCurrent(lease);
    if (!authorization.allowed) {
      revokeFeedbackAuthorization(createFeedbackConsentStatus(authorization));
      setStatus(createFeedbackConsentStatus(authorization));
      presentFeedbackConsentRequired(createFeedbackConsentStatus(authorization));
      return null;
    }

    const endpointAccess = await containsFeedbackEndpointAccess(lease.endpoint);
    feedbackSendControl.assertCurrent(lease);
    if (!endpointAccess) {
      setDetailedMode(true);
      setStatus('Feedback was not sent. Press Save beside the endpoint to grant access to its origin.');
      setFeedbackStatus('Feedback was not sent. Press Save beside the endpoint to grant access to its origin.');
      feedbackEndpointInput?.focus();
      return null;
    }

    const clientId = await loadAnonymousClientId(lease);
    feedbackSendControl.assertCurrent(lease);

    const sendAuthorization = await readFeedbackAuthorization();
    feedbackSendControl.assertCurrent(lease);
    if (!sendAuthorization.allowed) {
      revokeFeedbackAuthorization(createFeedbackConsentStatus(sendAuthorization));
      setStatus(createFeedbackConsentStatus(sendAuthorization));
      presentFeedbackConsentRequired(createFeedbackConsentStatus(sendAuthorization));
      return null;
    }

    const payload = JSON.parse(payloadSnapshot) as ReturnType<typeof createOccurrenceFeedbackPayload>;
    if (clientId) payload.clientId = clientId;
    const response = await fetch(lease.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      credentials: 'omit',
      signal: lease.signal
    });
    feedbackSendControl.assertCurrent(lease);
    if (!response.ok) {
      throw new Error(`Server returned HTTP ${response.status}.`);
    }
    const responseBody = await response.json().catch(() => null) as { deduplicated?: unknown } | null;
    const outcome = responseBody?.deduplicated === true ? 'deduplicated' : 'created';
    setStatus(outcome === 'deduplicated' ? 'Feedback already received.' : 'Feedback sent.');
    return outcome;
  } catch (error) {
    if (isFeedbackSendInvalidatedError(error) || !feedbackSendControl.isCurrent(lease)) return null;
    const message = error instanceof Error ? error.message : String(error);
    setStatus(`Feedback failed: ${message}`);
    return null;
  } finally {
    feedbackSendControl.finish(lease);
    if (trigger) trigger.disabled = false;
  }
}

function presentFeedbackConsentRequired(message: string): void {
  setDetailedMode(true);
  if (feedbackConsentInput) feedbackConsentInput.checked = false;
  if (feedbackConsentPanel) {
    feedbackConsentPanel.dataset.attention = 'true';
    feedbackConsentPanel.scrollIntoView({ block: 'nearest' });
  }
  setFeedbackConsentStatus(message);
  setFeedbackStatus('Feedback was not sent. Turn on Share feedback in Advanced first.');
  feedbackConsentInput?.focus({ preventScroll: true });
}

async function readFeedbackAuthorization(): Promise<FeedbackAuthorization> {
  const storedConsent = await getLocalStorageValue(FEEDBACK_CONSENT_STORAGE_KEY);
  const firefox = isFirefoxRuntime();
  const firefoxPermissionGranted = firefox
    ? await containsFeedbackDataCollectionPermission()
    : undefined;

  return evaluateFeedbackAuthorization({
    storedConsent,
    isFirefox: firefox,
    ...(firefoxPermissionGranted === undefined ? {} : { firefoxPermissionGranted })
  });
}

function createFeedbackConsentStatus(authorization: FeedbackAuthorization): string {
  if (authorization.allowed) {
    return 'Feedback sharing is on. Reports are sent only when you press a feedback button.';
  }
  if (authorization.reason === 'firefox-permission-required') {
    return 'Feedback sharing is off because the optional Firefox data permission is not granted.';
  }
  return 'Feedback sharing is off. Turn it on to send a report when you press a feedback button.';
}

async function synchronizeFeedbackAuthorization(): Promise<void> {
  const generation = feedbackSendControl.getConsentGeneration();
  try {
    const authorization = await readFeedbackAuthorization();
    applyFeedbackAuthorization(generation, authorization);
  } catch (error) {
    if (feedbackSendControl.getConsentGeneration() !== generation) return;
    const message = error instanceof Error ? error.message : String(error);
    revokeFeedbackAuthorization(`Feedback sharing is off because consent could not be verified: ${message}`);
  }
}

function applyFeedbackAuthorization(generation: number, authorization: FeedbackAuthorization): void {
  if (feedbackSendControl.getConsentGeneration() !== generation) return;
  if (!authorization.allowed) {
    revokeFeedbackAuthorization(createFeedbackConsentStatus(authorization));
    return;
  }
  if (!feedbackSendControl.authorizeConsentIfCurrent(generation)) return;
  if (feedbackConsentInput) feedbackConsentInput.checked = true;
  setFeedbackConsentStatus(createFeedbackConsentStatus(authorization));
}

function revokeFeedbackAuthorization(consentMessage: string, sendMessage?: string): void {
  feedbackSendControl.revokeConsent();
  if (feedbackConsentInput) feedbackConsentInput.checked = false;
  setFeedbackConsentStatus(consentMessage);
  if (sendMessage) setFeedbackStatus(sendMessage);
}

async function refreshFeedbackEndpointAccessView(
  endpoint: string | null,
  generation: number,
  identityChanged: boolean
): Promise<void> {
  if (!endpoint) {
    if (feedbackSendControl.isEndpointGenerationCurrent(generation)) {
      setFeedbackStatus(identityChanged
        ? 'Feedback endpoint removed. Pending feedback was cancelled.'
        : 'No feedback endpoint saved.');
    }
    return;
  }

  try {
    const granted = await containsFeedbackEndpointAccess(endpoint);
    if (!feedbackSendControl.isEndpointGenerationCurrent(generation)) return;
    setFeedbackStatus(granted
      ? `Feedback endpoint ready${identityChanged ? '. Pending feedback was cancelled because the endpoint changed.' : '.'}`
      : 'Feedback endpoint saved without origin access. Press Save to grant access before sending.');
  } catch (error) {
    if (!feedbackSendControl.isEndpointGenerationCurrent(generation)) return;
    const message = error instanceof Error ? error.message : String(error);
    setFeedbackStatus(`Could not verify feedback endpoint access: ${message}`);
  }
}

function containsFeedbackEndpointAccess(endpoint: string): Promise<boolean> {
  const origin = createFeedbackEndpointOriginPermission(endpoint);
  if (!origin) return Promise.resolve(false);
  return containsPermissions({ origins: [origin] });
}

function requestFeedbackEndpointAccess(endpoint: string): Promise<boolean> {
  const origin = createFeedbackEndpointOriginPermission(endpoint);
  if (!origin) return Promise.resolve(false);
  return requestPermissions({ origins: [origin] });
}

function isFirefoxRuntime(): boolean {
  return isFirefoxExtensionUrl(chrome.runtime.getURL(''));
}

interface FeedbackPermissionsApi {
  contains(permissions: FeedbackDataCollectionPermissionRequest, callback: (result: boolean) => void): void;
  request(permissions: FeedbackDataCollectionPermissionRequest, callback: (granted: boolean) => void): void;
  remove(permissions: FeedbackDataCollectionPermissionRequest, callback: (removed: boolean) => void): void;
  onRemoved: {
    addListener(listener: (permissions: unknown) => void): void;
    removeListener(listener: (permissions: unknown) => void): void;
  };
}

function getFeedbackPermissionsApi(): FeedbackPermissionsApi {
  const permissionsApi = chrome.permissions as unknown as Partial<FeedbackPermissionsApi>;
  if (
    typeof permissionsApi.contains !== 'function'
    || typeof permissionsApi.request !== 'function'
    || typeof permissionsApi.remove !== 'function'
    || typeof permissionsApi.onRemoved?.addListener !== 'function'
    || typeof permissionsApi.onRemoved?.removeListener !== 'function'
  ) {
    throw new Error('Firefox data permissions are unavailable.');
  }
  return permissionsApi as FeedbackPermissionsApi;
}

function containsFeedbackDataCollectionPermission(): Promise<boolean> {
  return callFeedbackPermissionMethod('contains');
}

function requestFeedbackDataCollectionPermission(): Promise<boolean> {
  return callFeedbackPermissionMethod('request');
}

function removeFeedbackDataCollectionPermission(): Promise<boolean> {
  return callFeedbackPermissionMethod('remove');
}

function callFeedbackPermissionMethod(method: 'contains' | 'request' | 'remove'): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const permissionsApi = getFeedbackPermissionsApi();
    permissionsApi[method](createFeedbackDataCollectionPermissionRequest(), (result) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve(result);
    });
  });
}

function getFeedbackContext(
  scanStatus: ScanStatusSnapshot,
  occurrenceId: string,
  occurrenceType: OccurrenceFeedbackType
): Partial<Parameters<typeof createOccurrenceFeedbackPayload>[0]> {
  const candidate = occurrenceType === 'candidate'
    ? scanStatus.candidates.find((item) => item.id === occurrenceId)
    : undefined;
  const evidence = occurrenceType === 'evidence'
    ? scanStatus.recentEvidence.find((item) => item.id === occurrenceId)
    : undefined;

  return {
    modelId: candidate?.modelId ?? scanStatus.model.modelId,
    modelVersion: candidate?.modelVersion ?? scanStatus.model.modelVersion,
    modelSource: candidate?.modelSource ?? scanStatus.model.modelSource,
    featureSchemaVersion: candidate?.featureSchemaVersion ?? scanStatus.model.featureSchemaVersion ?? undefined,
    heuristicConfidence: candidate?.heuristicConfidence,
    modelConfidence: candidate?.modelConfidence,
    candidateFeatures: candidate?.candidateFeatures,
    evidenceSnapshot: candidate?.evidenceSnapshot ?? (evidence ? [toFeedbackEvidenceSnapshot(evidence)] : undefined),
    transcriptContext: candidate?.transcriptContext
  };
}

async function loadAnonymousClientId(lease: FeedbackSendLease): Promise<string | null> {
  feedbackSendControl.assertCurrent(lease);
  anonymousClientIdPromise ??= loadOrCreateAnonymousClientId();
  try {
    const clientId = await anonymousClientIdPromise;
    feedbackSendControl.assertCurrent(lease);
    return clientId;
  } catch (error) {
    if (isFeedbackSendInvalidatedError(error)) throw error;
    anonymousClientIdPromise = null;
    return null;
  }
}

async function loadOrCreateAnonymousClientId(): Promise<string | null> {
  const stored = await getLocalStorageValue(CLIENT_ID_STORAGE_KEY);
  if (isValidClientId(stored)) return stored;
  const clientId = createAnonymousClientId();
  await setLocalStorageValue(CLIENT_ID_STORAGE_KEY, clientId);
  return clientId;
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
  endSeconds?: number;
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
    endSeconds?: number;
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
  if (input.endSeconds !== undefined) button.dataset.endSeconds = String(input.endSeconds);
  button.dataset.summary = input.summary;
  if (input.source) button.dataset.source = input.source;
  if (input.reason) button.dataset.reason = input.reason;
  return button;
}

function getActiveTab(): Promise<{ id: number; url: string | null }> {
  return new Promise((resolve, reject) => {
    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      if (!isValidScanStatusTabId(tab?.id)) {
        reject(new Error('No active browser tab found.'));
        return;
      }
      resolve({
        id: tab.id,
        url: typeof tab.url === 'string' ? tab.url : null
      });
    });
  });
}

function getYouTubeWatchVideoId(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (!isYouTubeWatchUrl(url)) return null;
    return getYouTubeVideoIdFromUrl(url);
  } catch {
    return null;
  }
}

function getRelevantScanStatus(statusSnapshot: ScanStatusSnapshot): ScanStatusSnapshot {
  if (
    statusSnapshot.phase === 'idle'
    || (activeWatchVideoId
      && statusSnapshot.platformId === 'youtube'
      && statusSnapshot.videoId === activeWatchVideoId)
  ) {
    return statusSnapshot;
  }
  return createIdleScanStatus();
}

function getOwnedTabId(): number {
  if (!isValidScanStatusTabId(ownedTabId)) {
    throw new Error('The popup has no active tab ownership. Reopen it on a YouTube tab.');
  }
  return ownedTabId;
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

function sendScanCapabilityMessage(tabId: number): Promise<{ ok: boolean; ready: boolean; error?: string }> {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(
      tabId,
      { type: scanCapabilityMessageType },
      (response?: { ok: boolean; ready: boolean; error?: string }) => {
        const error = chrome.runtime.lastError;
        if (error) {
          reject(new Error(error.message));
          return;
        }
        resolve(response ?? { ok: false, ready: false, error: 'No response from YapSkippr in this tab.' });
      }
    );
  });
}

function sendMissedSegmentContextMessage(
  tabId: number,
  startSeconds: number,
  endSeconds: number
): Promise<MissedSegmentContextResponse> {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(
      tabId,
      { type: missedSegmentContextMessageType, startSeconds, endSeconds },
      (response?: MissedSegmentContextResponse) => {
        const error = chrome.runtime.lastError;
        if (error) {
          reject(new Error(error.message));
          return;
        }
        resolve(response ?? { ok: false, error: 'No response from YapSkippr in this tab.' });
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
