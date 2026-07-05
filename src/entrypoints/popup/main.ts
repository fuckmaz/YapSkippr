import './style.css';
import { createIdleScanStatus } from '../../core/scan-status';
import { readStoredScanStatus, subscribeToStoredScanStatus } from '../../core/scan-status-storage';
import { createPopupScanStatusView } from '../../ui/popup-scan-status-view';

const frameCaptureOrigins = ['<all_urls>'];
const status = document.querySelector('#status');
const permissionStatus = document.querySelector('#permission-status');
const grantAccessButton = document.querySelector<HTMLButtonElement>('#grant-access');
const scanTitle = document.querySelector('#scan-title');
const scanPhase = document.querySelector('#scan-phase');
const scanMessage = document.querySelector('#scan-message');
const scanProgressText = document.querySelector('#scan-progress-text');
const scanProgressBar = document.querySelector<HTMLElement>('#scan-progress-bar');
const scanSamples = document.querySelector('#scan-samples');
const scanCandidateCount = document.querySelector('#scan-candidate-count');
const scanCandidates = document.querySelector<HTMLOListElement>('#scan-candidates');
const scanUpdated = document.querySelector('#scan-updated');

status?.replaceChildren(document.createTextNode('Detection status is mirrored here while a YouTube tab is scanning.'));

grantAccessButton?.addEventListener('click', () => {
  void requestFrameCaptureAccess();
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
  scanSamples?.replaceChildren(document.createTextNode(view.sampleCountText));
  scanCandidateCount?.replaceChildren(document.createTextNode(view.candidateCountText));
  scanUpdated?.replaceChildren(document.createTextNode(view.updatedText));

  if (!scanCandidates) return;
  scanCandidates.replaceChildren(
    ...view.candidateSummaries.map((summary) => {
      const item = document.createElement('li');
      item.textContent = summary;
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
