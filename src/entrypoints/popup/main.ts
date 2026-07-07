import './style.css';
import { createIdleScanStatus } from '../../core/scan-status';
import { readStoredScanStatus, subscribeToStoredScanStatus } from '../../core/scan-status-storage';
import { createPopupScanStatusView } from '../../ui/popup-scan-status-view';

const frameCaptureOrigins = ['<all_urls>'];
const seekToMessageType = 'YAPSKIPPR_SEEK_TO';
const fastScanMessageType = 'YAPSKIPPR_SET_FAST_SCAN';
const status = document.querySelector('#status');
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
const scanUpdated = document.querySelector('#scan-updated');

status?.replaceChildren(document.createTextNode('Detection status is mirrored here while a YouTube tab is scanning.'));

grantAccessButton?.addEventListener('click', () => {
  void requestFrameCaptureAccess();
});

scanCandidates?.addEventListener('click', (event) => {
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

renderScanStatus(createIdleScanStatus());
void loadScanStatus();
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
      const summary = document.createElement('strong');
      const detail = document.createElement('span');
      const button = document.createElement('button');

      copy.className = 'candidate-copy';
      summary.textContent = candidate.summary;
      detail.textContent = candidate.detail;
      button.className = 'candidate-action';
      button.type = 'button';
      button.dataset.seekSeconds = String(candidate.seekSeconds);
      button.textContent = candidate.actionLabel;

      copy.append(summary, detail);
      item.append(copy, button);
      return item;
    })
  );

  scanEvents?.replaceChildren(
    ...view.events.map((event) => {
      const item = document.createElement('li');
      const message = document.createElement('span');
      const age = document.createElement('time');

      item.dataset.level = event.level;
      message.textContent = event.message;
      age.textContent = event.ageText;
      item.append(message, age);
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
