import {
  createBoundedOwnedStatusWriter,
  StaleOwnedStatusWriterError,
  type BoundedOwnedStatusWriterOptions
} from '../../src/core/owned-scan-status-writer';

test('recovers from a rejected initial claim and persists the current status', async () => {
  const claims = [null, 'recovered-token'];
  const writes: Array<{ token: string; value: string }> = [];
  const writer = createWriter({
    claim: async () => claims.shift() ?? null,
    writeOwned: async (token, value) => {
      writes.push({ token, value });
    }
  });

  await expect(writer.initialize()).resolves.toBe(false);
  expect(writer.isDegraded()).toBe(true);
  await expect(writer.write('latest-status')).resolves.toBeUndefined();
  expect(writes).toEqual([{ token: 'recovered-token', value: 'latest-status' }]);
  expect(writer.isDegraded()).toBe(false);
});

test('coalesces a thousand queued updates into one replaceable pending batch', async () => {
  const firstWrite = deferred<void>();
  const writes: number[] = [];
  const writer = createWriter<number>({
    writeOwned: async (_token, value) => {
      writes.push(value);
      if (writes.length === 1) await firstWrite.promise;
    }
  });

  await writer.initialize();
  const first = writer.write(0);
  await Promise.resolve();
  const burst = Array.from({ length: 1_000 }, (_, index) => writer.write(index + 1));
  expect(writes).toEqual([0]);
  expect(new Set(burst).size).toBe(1);

  firstWrite.resolve(undefined);
  await Promise.all([first, ...burst]);
  expect(writes).toEqual([0, 1_000]);
});

test('reclaims after an in-flight rejection and persists only the newest pending status', async () => {
  const firstWrite = deferred<void>();
  const claims = ['old-token', 'new-token'];
  const writes: Array<{ token: string; value: string }> = [];
  const writer = createWriter({
    claim: async () => claims.shift() ?? null,
    writeOwned: async (token, value) => {
      writes.push({ token, value });
      if (token === 'old-token') await firstWrite.promise;
    }
  });

  await writer.initialize();
  const older = writer.write('older-status');
  await Promise.resolve();
  const overwritten = writer.write('intermediate-status');
  const latest = writer.write('latest-status');
  firstWrite.reject(new Error('owner rejected'));

  await expect(Promise.all([older, overwritten, latest])).resolves.toEqual([undefined, undefined, undefined]);
  expect(writes).toEqual([
    { token: 'old-token', value: 'older-status' },
    { token: 'new-token', value: 'latest-status' }
  ]);
});

test('resets the recovery budget after each confirmed successful persistence', async () => {
  const claims = ['initial-token', 'recovery-one', 'recovery-two'];
  const writes: Array<{ token: string; value: string }> = [];
  const writer = createWriter({
    maxClaimAttempts: 1,
    claim: async () => claims.shift() ?? null,
    writeOwned: async (token, value) => {
      writes.push({ token, value });
      if (token === 'initial-token' || (token === 'recovery-one' && value === 'second-loss')) {
        throw new Error(`rejected ${token}`);
      }
    }
  });

  await writer.initialize();
  await expect(writer.write('first-loss')).resolves.toBeUndefined();
  await expect(writer.write('second-loss')).resolves.toBeUndefined();

  expect(writes).toEqual([
    { token: 'initial-token', value: 'first-loss' },
    { token: 'recovery-one', value: 'first-loss' },
    { token: 'recovery-one', value: 'second-loss' },
    { token: 'recovery-two', value: 'second-loss' }
  ]);
  expect(writer.isDegraded()).toBe(false);
});

test('coalesces repeated writes behind one cooldown timer and recovers only the latest value', async () => {
  const failedWrite = deferred<void>();
  const claims = ['initial-token', null, null, 'later-token'];
  const scheduler = createRecoveryScheduler();
  let claimCount = 0;
  const writes: Array<{ token: string; value: string }> = [];
  const writer = createWriter({
    maxClaimAttempts: 2,
    recoveryBaseDelayMs: 100,
    recoveryMaxDelayMs: 800,
    now: scheduler.now,
    schedule: scheduler.schedule,
    cancel: scheduler.cancel,
    claim: async () => {
      claimCount += 1;
      return claims.shift() ?? null;
    },
    writeOwned: async (token, value) => {
      writes.push({ token, value });
      if (token === 'initial-token') await failedWrite.promise;
    }
  });

  await writer.initialize();
  const first = writer.write('first');
  await Promise.resolve();
  const coalesced = Array.from({ length: 100 }, (_, index) => writer.write(`burst-${index}`));
  failedWrite.reject(new Error('owner rejected'));
  await flushPromises();

  expect(claimCount).toBe(3);
  expect(writer.isDegraded()).toBe(true);
  expect(scheduler.pending()).toBe(1);
  expect(scheduler.nextDelay()).toBe(100);

  const cooldownWrites = Array.from({ length: 1_000 }, (_, index) => writer.write(`cooldown-${index}`));
  expect(new Set(cooldownWrites).size).toBe(1);
  expect(scheduler.pending()).toBe(1);
  expect(claimCount).toBe(3);

  scheduler.runNext();
  await Promise.all([first, ...coalesced, ...cooldownWrites]);
  expect(writes).toEqual([
    { token: 'initial-token', value: 'first' },
    { token: 'later-token', value: 'cooldown-999' }
  ]);
  expect(claimCount).toBe(4);
  expect(writer.isDegraded()).toBe(false);
  expect(scheduler.pending()).toBe(0);
});

test('increases recovery backoff to its cap and resets it after successful persistence', async () => {
  const scheduler = createRecoveryScheduler();
  const claims = ['initial-token', null, null, null, null, 'good-token', null, 'reset-token'];
  let rejectGoodToken = false;
  const writer = createWriter({
    maxClaimAttempts: 1,
    recoveryBaseDelayMs: 100,
    recoveryMaxDelayMs: 250,
    now: scheduler.now,
    schedule: scheduler.schedule,
    cancel: scheduler.cancel,
    claim: async () => claims.shift() ?? null,
    writeOwned: async (token) => {
      if (token === 'initial-token' || (token === 'good-token' && rejectGoodToken)) {
        throw new Error(`rejected ${token}`);
      }
    }
  });

  await writer.initialize();
  const recoveringWrite = writer.write('recover-with-backoff');
  await flushPromises();
  expect(scheduler.nextDelay()).toBe(100);

  scheduler.runNext();
  await flushPromises();
  expect(scheduler.nextDelay()).toBe(200);
  scheduler.runNext();
  await flushPromises();
  expect(scheduler.nextDelay()).toBe(250);
  scheduler.runNext();
  await flushPromises();
  expect(scheduler.nextDelay()).toBe(250);
  scheduler.runNext();
  await expect(recoveringWrite).resolves.toBeUndefined();
  expect(writer.isDegraded()).toBe(false);

  rejectGoodToken = true;
  const resetWrite = writer.write('backoff-reset');
  await flushPromises();
  expect(scheduler.nextDelay()).toBe(100);
  scheduler.runNext();
  await expect(resetWrite).resolves.toBeUndefined();
  expect(writer.isDegraded()).toBe(false);
});

test('a stale route cannot reclaim after an update rejection', async () => {
  let currentUrl = 'https://www.youtube.com/watch?v=owned';
  let claimCount = 0;
  const writer = createWriter({
    getCurrentUrl: () => currentUrl,
    claim: async () => `token-${++claimCount}`,
    writeOwned: async () => {
      currentUrl = 'https://www.youtube.com/watch?v=replaced';
      throw new Error('navigation rejected the write');
    }
  });

  await writer.initialize();
  await expect(writer.write('stale-status')).rejects.toBeInstanceOf(StaleOwnedStatusWriterError);
  expect(claimCount).toBe(1);
});

function createWriter<TValue = string>(overrides: Partial<BoundedOwnedStatusWriterOptions<TValue>> = {}) {
  return createBoundedOwnedStatusWriter<TValue>({
    routeUrl: 'https://www.youtube.com/watch?v=owned',
    isCurrent: () => true,
    getCurrentUrl: () => 'https://www.youtube.com/watch?v=owned',
    claim: async () => 'token',
    writeOwned: async () => undefined,
    ...overrides
  });
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void; reject(error: unknown): void } {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createRecoveryScheduler() {
  let currentTime = 0;
  let nextId = 1;
  const tasks = new Map<number, { callback: () => void; delayMs: number }>();
  return {
    now: () => currentTime,
    schedule(callback: () => void, delayMs: number) {
      const id = nextId++;
      tasks.set(id, { callback, delayMs });
      return id as unknown as ReturnType<typeof setTimeout>;
    },
    cancel(timer: ReturnType<typeof setTimeout>) {
      tasks.delete(timer as unknown as number);
    },
    runNext() {
      const next = tasks.entries().next().value as [number, { callback: () => void; delayMs: number }] | undefined;
      if (!next) throw new Error('No scheduled recovery callback.');
      tasks.delete(next[0]);
      currentTime += next[1].delayMs;
      next[1].callback();
    },
    nextDelay() {
      return tasks.values().next().value?.delayMs as number | undefined;
    },
    pending() {
      return tasks.size;
    }
  };
}

async function flushPromises(): Promise<void> {
  for (let index = 0; index < 12; index += 1) await Promise.resolve();
}
