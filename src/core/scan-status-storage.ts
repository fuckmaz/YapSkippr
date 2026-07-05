import {
  SCAN_STATUS_STORAGE_KEY,
  normalizeScanStatus,
  type ScanStatusSnapshot
} from './scan-status';

export function readStoredScanStatus(): Promise<ScanStatusSnapshot> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(SCAN_STATUS_STORAGE_KEY, (items) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }

      resolve(normalizeScanStatus(items[SCAN_STATUS_STORAGE_KEY]));
    });
  });
}

export function writeStoredScanStatus(status: ScanStatusSnapshot): Promise<void> {
  const normalized = normalizeScanStatus(status);
  return new Promise((resolve, reject) => {
    chrome.storage.local.set({ [SCAN_STATUS_STORAGE_KEY]: normalized }, () => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }

      resolve();
    });
  });
}

export function subscribeToStoredScanStatus(onStatus: (status: ScanStatusSnapshot) => void): () => void {
  const listener = (changes: Record<string, chrome.storage.StorageChange>, areaName: string): void => {
    if (areaName !== 'local') return;

    const change = changes[SCAN_STATUS_STORAGE_KEY];
    if (!change) return;

    onStatus(normalizeScanStatus(change.newValue));
  };

  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
