import { normalizeScanStatus, type ScanStatusSnapshot } from './scan-status';
import { isValidScanStatusTabId } from './scan-status-storage';

export interface ScanStatusOwnerRecord {
  tabId: number;
  pageUrl: string;
  documentId: string | null;
  token: string;
  claimedAt: number;
}

export interface ScanStatusSenderIdentity {
  tabId: number;
  pageUrl: string;
  documentId: string | null;
}

export interface StoredScanSessionEvaluation {
  owner: ScanStatusOwnerRecord | null;
  status: ScanStatusSnapshot | null;
  valid: boolean;
}

export interface SerializedTabOperations {
  currentNavigationGeneration(tabId: number): number;
  markNavigation(tabId: number): number;
  disposeNavigationGeneration(tabId: number, expectedGeneration: number): boolean;
  run<T>(tabId: number, operation: () => Promise<T>): Promise<T>;
}

export function createSerializedTabOperations(): SerializedTabOperations {
  const tails = new Map<number, Promise<void>>();
  const navigationGenerations = new Map<number, number>();

  return {
    currentNavigationGeneration(tabId) {
      return navigationGenerations.get(tabId) ?? 0;
    },

    markNavigation(tabId) {
      const generation = (navigationGenerations.get(tabId) ?? 0) + 1;
      navigationGenerations.set(tabId, generation);
      return generation;
    },

    disposeNavigationGeneration(tabId, expectedGeneration) {
      if (navigationGenerations.get(tabId) !== expectedGeneration) return false;
      navigationGenerations.delete(tabId);
      return true;
    },

    run(tabId, operation) {
      if (!isValidScanStatusTabId(tabId)) {
        return Promise.reject(new TypeError('Scan status operation requires a non-negative integer tab ID.'));
      }

      const previous = tails.get(tabId) ?? Promise.resolve();
      const result = previous.catch(() => undefined).then(operation);
      const tail = result.then(() => undefined, () => undefined);
      tails.set(tabId, tail);
      void tail.finally(() => {
        if (tails.get(tabId) === tail) tails.delete(tabId);
      });
      return result;
    }
  };
}

export function createScanStatusOwnerRecord(
  identity: ScanStatusSenderIdentity,
  token: string,
  claimedAt = Date.now()
): ScanStatusOwnerRecord {
  if (!isValidScanStatusTabId(identity.tabId) || !isNonEmptyString(identity.pageUrl) || !isNonEmptyString(token)) {
    throw new TypeError('Invalid scan status ownership claim.');
  }

  return {
    tabId: identity.tabId,
    pageUrl: identity.pageUrl,
    documentId: isNonEmptyString(identity.documentId) ? identity.documentId : null,
    token,
    claimedAt
  };
}

export function normalizeScanStatusOwnerRecord(value: unknown, expectedTabId: number): ScanStatusOwnerRecord | null {
  if (!isRecord(value)
    || !isValidScanStatusTabId(expectedTabId)
    || value.tabId !== expectedTabId
    || !isNonEmptyString(value.pageUrl)
    || !isNonEmptyString(value.token)
    || (value.documentId !== null && !isNonEmptyString(value.documentId))
    || typeof value.claimedAt !== 'number'
    || !Number.isFinite(value.claimedAt)
    || value.claimedAt < 0) {
    return null;
  }

  return {
    tabId: expectedTabId,
    pageUrl: value.pageUrl,
    documentId: value.documentId,
    token: value.token,
    claimedAt: Math.floor(value.claimedAt)
  };
}

export function validateOwnedScanStatusWrite(input: {
  owner: ScanStatusOwnerRecord | null;
  sender: ScanStatusSenderIdentity;
  liveTabUrl: string | null;
  token: unknown;
  status: unknown;
}): { ok: true; status: ScanStatusSnapshot } | { ok: false; error: string } {
  const owner = input.owner;
  if (!owner) return { ok: false, error: 'No active scan status ownership claim.' };
  if (!isNonEmptyString(input.token) || input.token !== owner.token) {
    return { ok: false, error: 'Scan status ownership token was rejected.' };
  }
  if (input.sender.tabId !== owner.tabId
    || input.sender.pageUrl !== owner.pageUrl
    || input.liveTabUrl !== owner.pageUrl) {
    return { ok: false, error: 'Scan status page ownership no longer matches the live tab.' };
  }
  if (owner.documentId !== null && input.sender.documentId !== owner.documentId) {
    return { ok: false, error: 'Scan status document ownership no longer matches.' };
  }

  const status = normalizeScanStatus(input.status);
  if (status.pageUrl !== owner.pageUrl) {
    return { ok: false, error: 'Scan status payload page URL does not match its owner.' };
  }
  return { ok: true, status };
}

export function evaluateStoredScanSession(input: {
  tabId: number;
  ownerValue: unknown;
  statusValue: unknown;
  liveTabUrl: string | null;
}): StoredScanSessionEvaluation {
  const owner = normalizeScanStatusOwnerRecord(input.ownerValue, input.tabId);
  if (!owner || input.liveTabUrl !== owner.pageUrl) {
    return { owner, status: null, valid: false };
  }

  if (input.statusValue === undefined) return { owner, status: null, valid: true };

  const status = normalizeScanStatus(input.statusValue);
  if (status.pageUrl !== owner.pageUrl) return { owner, status: null, valid: false };
  return { owner, status, valid: true };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}
