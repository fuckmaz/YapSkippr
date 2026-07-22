import {
  createScanStatusOwnerRecord,
  createSerializedTabOperations,
  evaluateStoredScanSession,
  validateOwnedScanStatusWrite
} from '../../src/core/scan-status-ownership';
import { createIdleScanStatus, mergeScanStatus } from '../../src/core/scan-status';

const pageUrl = 'https://www.youtube.com/watch?v=owned';
const sender = { tabId: 7, pageUrl, documentId: 'document-1' };

test('serializes navigation after an in-flight write and leaves the final badge idle', async () => {
  const operations = createSerializedTabOperations();
  const gate = deferred<void>();
  const events: string[] = [];
  let badge = 'initial';
  const writeGeneration = operations.currentNavigationGeneration(7);
  const write = operations.run(7, async () => {
    events.push('write-start');
    await gate.promise;
    if (operations.currentNavigationGeneration(7) !== writeGeneration) {
      events.push('write-rejected');
      return;
    }
    badge = 'running';
  });

  operations.markNavigation(7);
  const invalidate = operations.run(7, async () => {
    events.push('invalidate');
    badge = 'idle';
  });
  gate.resolve();
  await Promise.all([write, invalidate]);

  expect(events).toEqual(['write-start', 'write-rejected', 'invalidate']);
  expect(badge).toBe('idle');
});

test('does not return a claim token when navigation starts during awaited badge I/O', async () => {
  const operations = createSerializedTabOperations();
  const badgeGate = deferred<void>();
  const events: string[] = [];
  const claimGeneration = operations.currentNavigationGeneration(7);
  const claim = operations.run(7, async () => {
    events.push('owner-stored');
    await badgeGate.promise;
    events.push('badge-finished');
    if (operations.currentNavigationGeneration(7) !== claimGeneration) {
      events.push('claim-rejected');
      throw new Error('navigation invalidated claim');
    }
    return 'claim-token';
  });

  operations.markNavigation(7);
  const invalidate = operations.run(7, async () => {
    events.push('session-cleared');
  });
  badgeGate.resolve(undefined);

  await expect(claim).rejects.toThrow('navigation invalidated claim');
  await invalidate;
  expect(events).toEqual(['owner-stored', 'badge-finished', 'claim-rejected', 'session-cleared']);
});

test('disposes removed-tab generations without deleting a reused tab generation', async () => {
  const operations = createSerializedTabOperations();
  const removedGeneration = operations.markNavigation(7);
  const cleanupGate = deferred<void>();
  const cleanup = operations.run(7, () => cleanupGate.promise);

  const reusedGeneration = operations.markNavigation(7);
  cleanupGate.resolve(undefined);
  await cleanup;

  expect(operations.disposeNavigationGeneration(7, removedGeneration)).toBe(false);
  expect(operations.currentNavigationGeneration(7)).toBe(reusedGeneration);
  expect(operations.disposeNavigationGeneration(7, reusedGeneration)).toBe(true);
  expect(operations.currentNavigationGeneration(7)).toBe(0);
});

test('same-URL new claim replaces the old token and rejects delayed old writes', () => {
  const oldOwner = createScanStatusOwnerRecord(sender, 'old-token', 100);
  const newOwner = createScanStatusOwnerRecord(sender, 'new-token', 200);
  const status = mergeScanStatus(createIdleScanStatus(100), {
    pageUrl,
    phase: 'frames'
  }, 300);

  expect(validateOwnedScanStatusWrite({
    owner: newOwner,
    sender,
    liveTabUrl: pageUrl,
    token: oldOwner.token,
    status
  })).toEqual({ ok: false, error: 'Scan status ownership token was rejected.' });
  expect(validateOwnedScanStatusWrite({
    owner: newOwner,
    sender,
    liveTabUrl: pageUrl,
    token: newOwner.token,
    status
  })).toEqual({ ok: true, status });
});

test('rejects document, live URL, and payload URL ownership mismatches', () => {
  const owner = createScanStatusOwnerRecord(sender, 'owned-token', 100);
  const status = mergeScanStatus(createIdleScanStatus(100), { pageUrl, phase: 'frames' }, 200);

  expect(validateOwnedScanStatusWrite({
    owner,
    sender: { ...sender, documentId: 'document-2' },
    liveTabUrl: pageUrl,
    token: owner.token,
    status
  }).ok).toBe(false);
  expect(validateOwnedScanStatusWrite({
    owner,
    sender,
    liveTabUrl: 'https://www.youtube.com/watch?v=other',
    token: owner.token,
    status
  }).ok).toBe(false);
  expect(validateOwnedScanStatusWrite({
    owner,
    sender,
    liveTabUrl: pageUrl,
    token: owner.token,
    status: { ...status, pageUrl: 'https://www.youtube.com/watch?v=other' }
  }).ok).toBe(false);
});

test('alarm validation keeps live owner-only claims and rejects orphan or mismatched records', () => {
  const owner = createScanStatusOwnerRecord(sender, 'owned-token', 100);
  const status = mergeScanStatus(createIdleScanStatus(100), { pageUrl, phase: 'frames' }, 200);

  expect(evaluateStoredScanSession({
    tabId: 7,
    ownerValue: owner,
    statusValue: undefined,
    liveTabUrl: pageUrl
  })).toEqual({ owner, status: null, valid: true });
  expect(evaluateStoredScanSession({
    tabId: 7,
    ownerValue: undefined,
    statusValue: status,
    liveTabUrl: pageUrl
  }).valid).toBe(false);
  expect(evaluateStoredScanSession({
    tabId: 7,
    ownerValue: owner,
    statusValue: status,
    liveTabUrl: 'https://www.youtube.com/watch?v=reused'
  }).valid).toBe(false);
});

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
