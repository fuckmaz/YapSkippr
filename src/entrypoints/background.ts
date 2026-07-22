import { createIdleScanStatus, type ScanStatusSnapshot } from '../core/scan-status';
import {
  collectReservedScanStatusKeysForCleanup,
  isValidScanStatusTabId,
  parseScanStatusOwnerStorageKey,
  parseScanStatusStorageKey,
  readAllLocalValuesForUpgrade,
  readAllStoredScanSessionValues,
  readStoredScanSession,
  readStoredScanStatusOwner,
  removeLocalScanStatusUpgradeKeys,
  removeStoredScanSession,
  removeStoredScanSessionKeys,
  replaceStoredScanStatusOwner,
  writeStoredScanStatusFromBackground
} from '../core/scan-status-storage';
import {
  createScanStatusOwnerRecord,
  createSerializedTabOperations,
  evaluateStoredScanSession,
  normalizeScanStatusOwnerRecord,
  validateOwnedScanStatusWrite,
  type ScanStatusSenderIdentity
} from '../core/scan-status-ownership';
import { createActionBadgeView } from '../ui/action-badge-view';

const CAPTURE_MESSAGE_TYPE = 'YAPSKIPPR_CAPTURE_VISIBLE_TAB';
const CLAIM_SCAN_STATUS_MESSAGE_TYPE = 'YAPSKIPPR_CLAIM_SCAN_STATUS';
const UPDATE_SCAN_STATUS_MESSAGE_TYPE = 'YAPSKIPPR_UPDATE_SCAN_STATUS';
const STALE_BADGE_REFRESH_ALARM = 'yapskippr.refresh-stale-badges';
const STALE_BADGE_REFRESH_PERIOD_MINUTES = 0.5;

interface BackgroundRequest {
  type?: string;
  token?: unknown;
  status?: unknown;
}

interface BackgroundResponse {
  ok: boolean;
  dataUrl?: string;
  tabId?: number;
  token?: string;
  error?: string;
}

const tabOperations = createSerializedTabOperations();

export default defineBackground(() => {
  console.log('[YapSkippr] background ready');
  chrome.tabs.onCreated.addListener((tab) => {
    if (isValidScanStatusTabId(tab.id)) invalidateTabScanSession(tab.id, true, 'tab created');
  });
  chrome.tabs.onRemoved.addListener((tabId) => invalidateTabScanSession(tabId, false, 'tab removed', true));
  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (typeof changeInfo.url === 'string' || changeInfo.status === 'loading') {
      invalidateTabScanSession(tabId, true, 'tab navigation');
    }
  });
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === STALE_BADGE_REFRESH_ALARM) void validateStoredScanSessions();
  });
  ensureStaleBadgeRefreshAlarm();

  const startupReady = cleanupReservedUpgradeKeys()
    .then(validateStoredScanSessions)
    .catch((error: unknown) => {
      console.error('[YapSkippr] scan session startup cleanup failed', error);
    });

  chrome.runtime.onMessage.addListener((
    message: BackgroundRequest,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response: BackgroundResponse) => void
  ) => {
    if (message?.type === CLAIM_SCAN_STATUS_MESSAGE_TYPE) {
      void startupReady
        .then(() => claimScanStatusOwnership(sender))
        .then(sendResponse, (error: unknown) => sendResponse({ ok: false, error: errorMessage(error) }));
      return true;
    }

    if (message?.type === UPDATE_SCAN_STATUS_MESSAGE_TYPE) {
      void startupReady
        .then(() => writeOwnedScanStatus(sender, message.token, message.status))
        .then(() => sendResponse({ ok: true }), (error: unknown) => {
          sendResponse({ ok: false, error: errorMessage(error) });
        });
      return true;
    }

    if (message?.type !== CAPTURE_MESSAGE_TYPE) return false;
    const windowId = sender.tab?.windowId;
    if (windowId === undefined) {
      sendResponse({ ok: false, error: 'No sender tab window was available.' });
      return false;
    }

    chrome.tabs.captureVisibleTab(windowId, { format: 'png' }, (dataUrl: string) => {
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

async function claimScanStatusOwnership(sender: chrome.runtime.MessageSender): Promise<BackgroundResponse> {
  const identity = senderIdentity(sender);
  const navigationGeneration = tabOperations.currentNavigationGeneration(identity.tabId);
  return tabOperations.run(identity.tabId, async () => {
    assertNavigationGeneration(identity.tabId, navigationGeneration);
    const liveTabUrl = await getLiveTabUrl(identity.tabId);
    if (liveTabUrl !== identity.pageUrl) throw new Error('Sender page does not match the live browser tab.');
    assertNavigationGeneration(identity.tabId, navigationGeneration);

    const token = createClaimToken();
    const owner = createScanStatusOwnerRecord(identity, token);
    await replaceStoredScanStatusOwner(identity.tabId, owner);
    if (tabOperations.currentNavigationGeneration(identity.tabId) !== navigationGeneration) {
      await removeStoredScanSession(identity.tabId);
      throw new Error('Tab navigation replaced the scan status ownership claim.');
    }
    await updateActionBadge(identity.tabId, createIdleScanStatus());
    if (tabOperations.currentNavigationGeneration(identity.tabId) !== navigationGeneration) {
      await removeStoredScanSession(identity.tabId);
      throw new Error('Tab navigation replaced the scan status ownership claim.');
    }
    return { ok: true, tabId: identity.tabId, token };
  });
}

async function writeOwnedScanStatus(
  sender: chrome.runtime.MessageSender,
  token: unknown,
  statusValue: unknown
): Promise<void> {
  const identity = senderIdentity(sender);
  const navigationGeneration = tabOperations.currentNavigationGeneration(identity.tabId);
  await tabOperations.run(identity.tabId, async () => {
    assertNavigationGeneration(identity.tabId, navigationGeneration);
    const [ownerValue, liveTabUrl] = await Promise.all([
      readStoredScanStatusOwner(identity.tabId),
      getLiveTabUrl(identity.tabId)
    ]);
    const owner = normalizeScanStatusOwnerRecord(ownerValue, identity.tabId);
    const validation = validateOwnedScanStatusWrite({
      owner,
      sender: identity,
      liveTabUrl,
      token,
      status: statusValue
    });
    if (!validation.ok) throw new Error(validation.error);
    assertNavigationGeneration(identity.tabId, navigationGeneration);

    await writeStoredScanStatusFromBackground(identity.tabId, validation.status);
    if (tabOperations.currentNavigationGeneration(identity.tabId) !== navigationGeneration) {
      await removeStoredScanSession(identity.tabId);
      throw new Error('Tab navigation invalidated the scan status update.');
    }
    await updateActionBadge(identity.tabId, validation.status);
    if (tabOperations.currentNavigationGeneration(identity.tabId) !== navigationGeneration) {
      await removeStoredScanSession(identity.tabId);
      throw new Error('Tab navigation invalidated the scan status update.');
    }
  });
}

function invalidateTabScanSession(
  tabId: number,
  resetBadge: boolean,
  reason: string,
  disposeNavigationGeneration = false
): void {
  if (!isValidScanStatusTabId(tabId)) return;
  const navigationGeneration = tabOperations.markNavigation(tabId);
  const cleanup = tabOperations.run(tabId, async () => {
    await removeStoredScanSession(tabId);
    if (resetBadge) await updateActionBadge(tabId, createIdleScanStatus());
  }).catch((error: unknown) => {
    console.debug(`[YapSkippr] could not invalidate scan session after ${reason}`, error);
  });
  if (disposeNavigationGeneration) {
    void cleanup.finally(() => {
      tabOperations.disposeNavigationGeneration(tabId, navigationGeneration);
    });
  }
}

async function cleanupReservedUpgradeKeys(): Promise<void> {
  const [localValues, sessionValues] = await Promise.all([
    readAllLocalValuesForUpgrade(),
    readAllStoredScanSessionValues()
  ]);
  await Promise.all([
    removeLocalScanStatusUpgradeKeys(collectReservedScanStatusKeysForCleanup(localValues, 'local')),
    removeStoredScanSessionKeys(collectReservedScanStatusKeysForCleanup(sessionValues, 'session'))
  ]);
}

async function validateStoredScanSessions(): Promise<void> {
  try {
    const sessionValues = await readAllStoredScanSessionValues();
    const malformedKeys = collectReservedScanStatusKeysForCleanup(sessionValues, 'session');
    if (malformedKeys.length > 0) await removeStoredScanSessionKeys(malformedKeys);

    const tabIds = new Set<number>();
    for (const storageKey of Object.keys(sessionValues)) {
      const tabId = parseScanStatusStorageKey(storageKey) ?? parseScanStatusOwnerStorageKey(storageKey);
      if (tabId !== null) tabIds.add(tabId);
    }
    await Promise.all([...tabIds].map(validateStoredScanSession));
  } catch (error) {
    console.error('[YapSkippr] could not validate stored scan sessions', error);
  }
}

async function validateStoredScanSession(tabId: number): Promise<void> {
  await tabOperations.run(tabId, async () => {
    const [{ ownerValue, statusValue }, liveTabUrl] = await Promise.all([
      readStoredScanSession(tabId),
      getLiveTabUrl(tabId)
    ]);
    const evaluation = evaluateStoredScanSession({ tabId, ownerValue, statusValue, liveTabUrl });
    if (!evaluation.valid) {
      await removeStoredScanSession(tabId);
      if (liveTabUrl !== null) await updateActionBadge(tabId, createIdleScanStatus());
      return;
    }
    await updateActionBadge(tabId, evaluation.status ?? createIdleScanStatus());
  });
}

function senderIdentity(sender: chrome.runtime.MessageSender): ScanStatusSenderIdentity {
  const tabId = sender.tab?.id;
  if (!isValidScanStatusTabId(tabId)) throw new Error('No valid sender tab ID was available.');
  if (sender.frameId !== undefined && sender.frameId !== 0) throw new Error('Scan status claims require the top frame.');
  if (typeof sender.url !== 'string' || !sender.url) throw new Error('No sender document URL was available.');
  return {
    tabId,
    pageUrl: sender.url,
    documentId: typeof sender.documentId === 'string' && sender.documentId ? sender.documentId : null
  };
}

function assertNavigationGeneration(tabId: number, expected: number): void {
  if (tabOperations.currentNavigationGeneration(tabId) !== expected) {
    throw new Error('Tab navigation invalidated this scan status operation.');
  }
}

function getLiveTabUrl(tabId: number): Promise<string | null> {
  return new Promise((resolve) => {
    chrome.tabs.get(tabId, (tab) => {
      const error = chrome.runtime.lastError;
      if (error) {
        resolve(null);
        return;
      }
      resolve(typeof tab?.url === 'string' && tab.url ? tab.url : null);
    });
  });
}

function createClaimToken(): string {
  const bytes = new Uint8Array(24);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
}

function ensureStaleBadgeRefreshAlarm(): void {
  chrome.alarms.get(STALE_BADGE_REFRESH_ALARM, (alarm) => {
    const error = chrome.runtime.lastError;
    if (error) {
      console.error('[YapSkippr] could not inspect stale badge refresh alarm', error.message);
      return;
    }
    if (alarm?.periodInMinutes === STALE_BADGE_REFRESH_PERIOD_MINUTES) return;
    chrome.alarms.create(STALE_BADGE_REFRESH_ALARM, {
      periodInMinutes: STALE_BADGE_REFRESH_PERIOD_MINUTES
    }, () => {
      const createError = chrome.runtime.lastError;
      if (createError) console.error('[YapSkippr] could not create stale badge refresh alarm', createError.message);
    });
  });
}

async function updateActionBadge(tabId: number, status: ScanStatusSnapshot): Promise<void> {
  const action = getActionApi();
  if (!action) return;
  const view = createActionBadgeView(status);
  await Promise.all([
    runActionMutation('badge text', tabId, (done) => action.setBadgeText({ tabId, text: view.text }, done)),
    runActionMutation('badge color', tabId, (done) => {
      action.setBadgeBackgroundColor({ tabId, color: view.color }, done);
    }),
    runActionMutation('action title', tabId, (done) => action.setTitle({ tabId, title: view.title }, done))
  ]);
}

function runActionMutation(
  operation: string,
  tabId: number,
  mutate: (done: () => void) => void
): Promise<void> {
  return new Promise((resolve) => {
    try {
      mutate(() => {
        const error = chrome.runtime.lastError;
        if (error) console.debug(`[YapSkippr] could not update ${operation} for tab ${tabId}`, error.message);
        resolve();
      });
    } catch (error) {
      console.debug(`[YapSkippr] could not update ${operation} for tab ${tabId}`, error);
      resolve();
    }
  });
}

function getActionApi(): Pick<typeof chrome.action, 'setBadgeBackgroundColor' | 'setBadgeText' | 'setTitle'> | undefined {
  return chrome.action ?? chrome.browserAction;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
