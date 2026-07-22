import { normalizeScanStatus, type ScanStatusSnapshot } from './scan-status';

export const SCAN_STATUS_STORAGE_KEY_PREFIX = 'yapskippr.scanStatus.';
export const SCAN_STATUS_OWNER_STORAGE_KEY_PREFIX = 'yapskippr.scanOwner.';
const LEGACY_SCAN_STATUS_STORAGE_KEY = SCAN_STATUS_STORAGE_KEY_PREFIX.slice(0, -1);
const LEGACY_SCAN_STATUS_OWNER_STORAGE_KEY = SCAN_STATUS_OWNER_STORAGE_KEY_PREFIX.slice(0, -1);

export function isValidScanStatusTabId(tabId: unknown): tabId is number {
  return typeof tabId === 'number'
    && Number.isSafeInteger(tabId)
    && tabId >= 0;
}

export function createScanStatusStorageKey(tabId: number): string {
  return createTabStorageKey(SCAN_STATUS_STORAGE_KEY_PREFIX, tabId);
}

export function createScanStatusOwnerStorageKey(tabId: number): string {
  return createTabStorageKey(SCAN_STATUS_OWNER_STORAGE_KEY_PREFIX, tabId);
}

export function parseScanStatusStorageKey(storageKey: string): number | null {
  return parseTabStorageKey(SCAN_STATUS_STORAGE_KEY_PREFIX, storageKey);
}

export function parseScanStatusOwnerStorageKey(storageKey: string): number | null {
  return parseTabStorageKey(SCAN_STATUS_OWNER_STORAGE_KEY_PREFIX, storageKey);
}

export function collectReservedScanStatusKeysForCleanup(
  storedValues: Readonly<Record<string, unknown>>,
  areaName: 'local' | 'session'
): string[] {
  const keys: string[] = [];
  for (const storageKey of Object.keys(storedValues)) {
    if (areaName === 'local') {
      if (storageKey === LEGACY_SCAN_STATUS_STORAGE_KEY
        || storageKey === LEGACY_SCAN_STATUS_OWNER_STORAGE_KEY
        || storageKey.startsWith(SCAN_STATUS_STORAGE_KEY_PREFIX)
        || storageKey.startsWith(SCAN_STATUS_OWNER_STORAGE_KEY_PREFIX)) {
        keys.push(storageKey);
      }
      continue;
    }

    if (storageKey === LEGACY_SCAN_STATUS_STORAGE_KEY
      || storageKey === LEGACY_SCAN_STATUS_OWNER_STORAGE_KEY
      || (storageKey.startsWith(SCAN_STATUS_STORAGE_KEY_PREFIX)
        && parseScanStatusStorageKey(storageKey) === null)
      || (storageKey.startsWith(SCAN_STATUS_OWNER_STORAGE_KEY_PREFIX)
        && parseScanStatusOwnerStorageKey(storageKey) === null)) {
      keys.push(storageKey);
    }
  }
  return keys;
}

export function readStoredScanStatus(tabId: number): Promise<ScanStatusSnapshot> {
  const storageKey = createScanStatusStorageKey(tabId);
  return getStorageValues(getSessionStorageArea(), storageKey)
    .then((items) => normalizeScanStatus(items[storageKey]));
}

export function readStoredScanStatusOwner(tabId: number): Promise<unknown> {
  const storageKey = createScanStatusOwnerStorageKey(tabId);
  return getStorageValues(getSessionStorageArea(), storageKey).then((items) => items[storageKey]);
}

export function readStoredScanSession(tabId: number): Promise<{ ownerValue: unknown; statusValue: unknown }> {
  const ownerKey = createScanStatusOwnerStorageKey(tabId);
  const statusKey = createScanStatusStorageKey(tabId);
  return getStorageValues(getSessionStorageArea(), [ownerKey, statusKey]).then((items) => ({
    ownerValue: items[ownerKey],
    statusValue: items[statusKey]
  }));
}

export function readAllStoredScanSessionValues(): Promise<Record<string, unknown>> {
  return getStorageValues(getSessionStorageArea(), null);
}

export function readAllLocalValuesForUpgrade(): Promise<Record<string, unknown>> {
  return getStorageValues(chrome.storage.local, null);
}

export function replaceStoredScanStatusOwner(tabId: number, owner: unknown): Promise<void> {
  const ownerKey = createScanStatusOwnerStorageKey(tabId);
  const statusKey = createScanStatusStorageKey(tabId);
  return removeStorageKeys(getSessionStorageArea(), statusKey)
    .then(() => setStorageValues(getSessionStorageArea(), { [ownerKey]: owner }));
}

export function writeStoredScanStatusFromBackground(tabId: number, status: ScanStatusSnapshot): Promise<void> {
  const storageKey = createScanStatusStorageKey(tabId);
  return setStorageValues(getSessionStorageArea(), { [storageKey]: normalizeScanStatus(status) });
}

export function removeStoredScanSession(tabId: number): Promise<void> {
  return removeStorageKeys(getSessionStorageArea(), [
    createScanStatusOwnerStorageKey(tabId),
    createScanStatusStorageKey(tabId)
  ]);
}

export function removeStoredScanSessionKeys(storageKeys: string[]): Promise<void> {
  if (storageKeys.length === 0) return Promise.resolve();
  return removeStorageKeys(getSessionStorageArea(), storageKeys);
}

export function removeLocalScanStatusUpgradeKeys(storageKeys: string[]): Promise<void> {
  if (storageKeys.length === 0) return Promise.resolve();
  return removeStorageKeys(chrome.storage.local, storageKeys);
}

export function subscribeToStoredScanStatus(
  tabId: number,
  onStatus: (status: ScanStatusSnapshot) => void
): () => void {
  const storageKey = createScanStatusStorageKey(tabId);
  const listener = (changes: Record<string, chrome.storage.StorageChange>, areaName: string): void => {
    if (areaName !== 'session') return;

    const change = changes[storageKey];
    if (!change) return;
    onStatus(normalizeScanStatus(change.newValue));
  };

  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}

function createTabStorageKey(prefix: string, tabId: number): string {
  if (!isValidScanStatusTabId(tabId)) {
    throw new TypeError('Scan status requires a non-negative integer tab ID.');
  }
  return `${prefix}${tabId}`;
}

function parseTabStorageKey(prefix: string, storageKey: string): number | null {
  if (!storageKey.startsWith(prefix)) return null;
  const suffix = storageKey.slice(prefix.length);
  if (!/^(?:0|[1-9]\d*)$/.test(suffix)) return null;
  const tabId = Number(suffix);
  return isValidScanStatusTabId(tabId) ? tabId : null;
}

function getSessionStorageArea(): chrome.storage.SessionStorageArea {
  if (!chrome.storage.session) {
    throw new Error('This browser does not provide extension session storage.');
  }
  return chrome.storage.session;
}

function getStorageValues(
  storageArea: chrome.storage.StorageArea,
  keys: string | string[] | null
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    storageArea.get(keys, (items) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve(items);
    });
  });
}

function setStorageValues(
  storageArea: chrome.storage.StorageArea,
  values: Record<string, unknown>
): Promise<void> {
  return new Promise((resolve, reject) => {
    storageArea.set(values, () => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve();
    });
  });
}

function removeStorageKeys(
  storageArea: chrome.storage.StorageArea,
  storageKeys: string | string[]
): Promise<void> {
  return new Promise((resolve, reject) => {
    storageArea.remove(storageKeys, () => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve();
    });
  });
}
