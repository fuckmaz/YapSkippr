import { createIdleScanStatus } from '../core/scan-status';
import { readStoredScanStatus, subscribeToStoredScanStatus } from '../core/scan-status-storage';
import type { ScanStatusSnapshot } from '../core/scan-status';
import { createActionBadgeView } from '../ui/action-badge-view';

const CAPTURE_MESSAGE_TYPE = 'YAPSKIPPR_CAPTURE_VISIBLE_TAB';

interface CaptureVisibleTabRequest {
  type?: string;
}

interface CaptureVisibleTabResponse {
  ok: boolean;
  dataUrl?: string;
  error?: string;
}

export default defineBackground(() => {
  console.log('[YapSkippr] background ready');
  void refreshActionBadge();
  subscribeToStoredScanStatus(updateActionBadge);
  setInterval(() => void refreshActionBadge(), 15_000);

  chrome.runtime.onMessage.addListener((
    message: CaptureVisibleTabRequest,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response: CaptureVisibleTabResponse) => void
  ) => {
    if (message?.type !== CAPTURE_MESSAGE_TYPE) return false;

    const windowId = sender.tab?.windowId;
    if (windowId === undefined) {
      sendResponse({ ok: false, error: 'No sender tab window was available.' });
      return false;
    }

    chrome.tabs.captureVisibleTab(windowId, { format: 'jpeg', quality: 60 }, (dataUrl: string) => {
      const error = chrome.runtime.lastError;
      if (error) {
        sendResponse({ ok: false, error: error.message });
        return;
      }
      sendResponse({ ok: true, dataUrl });
    });

    return true;
  });
});

async function refreshActionBadge(): Promise<void> {
  try {
    updateActionBadge(await readStoredScanStatus());
  } catch {
    updateActionBadge(createIdleScanStatus());
  }
}

function updateActionBadge(status: ScanStatusSnapshot): void {
  const action = getActionApi();
  if (!action) return;

  const view = createActionBadgeView(status);
  action.setBadgeText({ text: view.text });
  action.setBadgeBackgroundColor({ color: view.color });
  action.setTitle({ title: view.title });
}

function getActionApi(): Pick<typeof chrome.action, 'setBadgeBackgroundColor' | 'setBadgeText' | 'setTitle'> | undefined {
  return chrome.action ?? chrome.browserAction;
}
