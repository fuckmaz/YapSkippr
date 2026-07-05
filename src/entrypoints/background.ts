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
