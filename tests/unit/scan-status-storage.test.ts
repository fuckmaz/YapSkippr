import {
  SCAN_STATUS_OWNER_STORAGE_KEY_PREFIX,
  SCAN_STATUS_STORAGE_KEY_PREFIX,
  collectReservedScanStatusKeysForCleanup,
  createScanStatusOwnerStorageKey,
  createScanStatusStorageKey,
  parseScanStatusOwnerStorageKey,
  parseScanStatusStorageKey,
  readStoredScanStatus,
  removeStoredScanSession,
  replaceStoredScanStatusOwner,
  subscribeToStoredScanStatus,
  writeStoredScanStatusFromBackground
} from '../../src/core/scan-status-storage';
import { createIdleScanStatus, mergeScanStatus } from '../../src/core/scan-status';

type StorageListener = (
  changes: Record<string, chrome.storage.StorageChange>,
  areaName: string
) => void;

afterEach(() => vi.unstubAllGlobals());

test('creates and parses canonical owner and status keys', () => {
  expect(SCAN_STATUS_STORAGE_KEY_PREFIX).toBe('yapskippr.scanStatus.');
  expect(SCAN_STATUS_OWNER_STORAGE_KEY_PREFIX).toBe('yapskippr.scanOwner.');
  expect(createScanStatusStorageKey(42)).toBe('yapskippr.scanStatus.42');
  expect(createScanStatusOwnerStorageKey(42)).toBe('yapskippr.scanOwner.42');
  expect(parseScanStatusStorageKey('yapskippr.scanStatus.42')).toBe(42);
  expect(parseScanStatusOwnerStorageKey('yapskippr.scanOwner.42')).toBe(42);
});

test.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
  'rejects malformed tab ID %s',
  (tabId) => {
    expect(() => createScanStatusStorageKey(tabId)).toThrow();
    expect(() => createScanStatusOwnerStorageKey(tabId)).toThrow();
  }
);

test.each([
  'yapskippr.scanStatus',
  'yapskippr.scanStatus.',
  'yapskippr.scanStatus.-1',
  'yapskippr.scanStatus.01',
  'yapskippr.scanOwner.invalid'
])('does not parse malformed reserved key %s', (storageKey) => {
  expect(parseScanStatusStorageKey(storageKey)).toBeNull();
  expect(parseScanStatusOwnerStorageKey(storageKey)).toBeNull();
});

test('reads and writes volatile scan status only in session storage', async () => {
  const storage = installChromeStorageMock();
  const sessionStatus = mergeScanStatus(createIdleScanStatus(100), {
    pageUrl: 'https://www.youtube.com/watch?v=session',
    videoId: 'session',
    phase: 'frames'
  }, 200);
  const localStatus = { ...sessionStatus, videoId: 'legacy-local' };
  storage.localValues.set('yapskippr.scanStatus.7', localStatus);

  await writeStoredScanStatusFromBackground(7, sessionStatus);

  expect(await readStoredScanStatus(7)).toEqual(sessionStatus);
  expect(storage.sessionValues.get('yapskippr.scanStatus.7')).toEqual(sessionStatus);
  expect(storage.localValues.get('yapskippr.scanStatus.7')).toEqual(localStatus);
});

test('replacing a same-tab owner clears old status before storing the new claim', async () => {
  const storage = installChromeStorageMock();
  storage.sessionValues.set('yapskippr.scanStatus.7', createIdleScanStatus(100));
  const owner = { tabId: 7, pageUrl: 'https://www.youtube.com/watch?v=new', token: 'new-token' };

  await replaceStoredScanStatusOwner(7, owner);

  expect(storage.sessionValues.has('yapskippr.scanStatus.7')).toBe(false);
  expect(storage.sessionValues.get('yapskippr.scanOwner.7')).toEqual(owner);
});

test('removes owner and status for only the requested tab', async () => {
  const storage = installChromeStorageMock();
  storage.sessionValues.set('yapskippr.scanOwner.7', { token: 'seven' });
  storage.sessionValues.set('yapskippr.scanStatus.7', createIdleScanStatus(100));
  storage.sessionValues.set('yapskippr.scanOwner.12', { token: 'twelve' });

  await removeStoredScanSession(7);

  expect(storage.sessionValues.has('yapskippr.scanOwner.7')).toBe(false);
  expect(storage.sessionValues.has('yapskippr.scanStatus.7')).toBe(false);
  expect(storage.sessionValues.has('yapskippr.scanOwner.12')).toBe(true);
});

test('subscription filters by owned tab and session area', () => {
  const storage = installChromeStorageMock();
  const onStatus = vi.fn();
  const status = mergeScanStatus(createIdleScanStatus(100), {
    pageUrl: 'https://www.youtube.com/watch?v=owned',
    phase: 'frames'
  }, 200);
  const unsubscribe = subscribeToStoredScanStatus(7, onStatus);

  storage.emit({ 'yapskippr.scanStatus.7': { newValue: status } }, 'local');
  storage.emit({ 'yapskippr.scanStatus.12': { newValue: status } }, 'session');
  expect(onStatus).not.toHaveBeenCalled();
  storage.emit({ 'yapskippr.scanStatus.7': { newValue: status } }, 'session');
  expect(onStatus).toHaveBeenCalledWith(status);

  unsubscribe();
  storage.emit({ 'yapskippr.scanStatus.7': { newValue: status } }, 'session');
  expect(onStatus).toHaveBeenCalledTimes(1);
});

test('upgrade cleanup reserves all local scan keys but only malformed session keys', () => {
  const values = {
    'yapskippr.scanStatus': {},
    'yapskippr.scanOwner': {},
    'yapskippr.scanStatus.7': {},
    'yapskippr.scanOwner.7': {},
    'yapskippr.scanStatus.bad': {},
    'yapskippr.feedbackEndpoint': 'https://feedback.example.test'
  };

  expect(collectReservedScanStatusKeysForCleanup(values, 'local')).toEqual([
    'yapskippr.scanStatus',
    'yapskippr.scanOwner',
    'yapskippr.scanStatus.7',
    'yapskippr.scanOwner.7',
    'yapskippr.scanStatus.bad'
  ]);
  expect(collectReservedScanStatusKeysForCleanup(values, 'session')).toEqual([
    'yapskippr.scanStatus',
    'yapskippr.scanOwner',
    'yapskippr.scanStatus.bad'
  ]);
});

function installChromeStorageMock(): {
  localValues: Map<string, unknown>;
  sessionValues: Map<string, unknown>;
  emit(changes: Record<string, chrome.storage.StorageChange>, areaName: string): void;
} {
  const localValues = new Map<string, unknown>();
  const sessionValues = new Map<string, unknown>();
  const listeners = new Set<StorageListener>();

  vi.stubGlobal('chrome', {
    runtime: { lastError: undefined },
    storage: {
      local: createStorageArea(localValues),
      session: createStorageArea(sessionValues),
      onChanged: {
        addListener: vi.fn((listener: StorageListener) => listeners.add(listener)),
        removeListener: vi.fn((listener: StorageListener) => listeners.delete(listener))
      }
    }
  });

  return {
    localValues,
    sessionValues,
    emit(changes, areaName) {
      for (const listener of listeners) listener(changes, areaName);
    }
  };
}

function createStorageArea(values: Map<string, unknown>): {
  get: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
} {
  return {
    get: vi.fn((keys: string | string[] | null, callback: (items: Record<string, unknown>) => void) => {
      const selected = keys === null
        ? [...values.keys()]
        : Array.isArray(keys) ? keys : [keys];
      callback(Object.fromEntries(selected.filter((key) => values.has(key)).map((key) => [key, values.get(key)])));
    }),
    set: vi.fn((items: Record<string, unknown>, callback: () => void) => {
      for (const [key, value] of Object.entries(items)) values.set(key, value);
      callback();
    }),
    remove: vi.fn((keys: string | string[], callback: () => void) => {
      for (const key of Array.isArray(keys) ? keys : [keys]) values.delete(key);
      callback();
    })
  };
}
