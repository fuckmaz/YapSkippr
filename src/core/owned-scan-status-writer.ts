export interface BoundedOwnedStatusWriter<TValue> {
  initialize(): Promise<boolean>;
  write(value: TValue): Promise<void>;
  isDegraded(): boolean;
}

export interface BoundedOwnedStatusWriterOptions<TValue> {
  routeUrl: string;
  isCurrent(): boolean;
  getCurrentUrl(): string;
  claim(): Promise<string | null>;
  writeOwned(token: string, value: TValue): Promise<void>;
  maxClaimAttempts?: number;
  recoveryBaseDelayMs?: number;
  recoveryMaxDelayMs?: number;
  now?: () => number;
  schedule?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  cancel?: (timer: ReturnType<typeof setTimeout>) => void;
}

export class StaleOwnedStatusWriterError extends Error {
  constructor() {
    super('Scan status persistence belongs to a stale route.');
    this.name = 'StaleOwnedStatusWriterError';
  }
}

interface WriteSettlement {
  promise: Promise<void>;
  resolve(): void;
  reject(error: unknown): void;
}

interface WriteBatch<TValue> {
  value: TValue;
  version: number;
  settlements: WriteSettlement[];
}

/** Keeps one route recoverable without letting an obsolete SPA boot reclaim ownership. */
export function createBoundedOwnedStatusWriter<TValue>(
  options: BoundedOwnedStatusWriterOptions<TValue>
): BoundedOwnedStatusWriter<TValue> {
  const maxClaimAttempts = normalizePositiveInteger(options.maxClaimAttempts, 3);
  const recoveryBaseDelayMs = normalizePositiveInteger(options.recoveryBaseDelayMs, 1_000);
  const recoveryMaxDelayMs = Math.max(
    recoveryBaseDelayMs,
    normalizePositiveInteger(options.recoveryMaxDelayMs, 30_000)
  );
  const now = options.now ?? Date.now;
  const schedule = options.schedule ?? ((callback, delayMs) => setTimeout(callback, delayMs));
  const cancel = options.cancel ?? ((timer) => clearTimeout(timer));
  let token: string | null = null;
  let degraded = false;
  let pending: WriteBatch<TValue> | null = null;
  let recovering: WriteBatch<TValue> | null = null;
  let draining = false;
  let recoveryNotBefore = 0;
  let nextRecoveryDelayMs = recoveryBaseDelayMs;
  let recoveryTimer: ReturnType<typeof setTimeout> | null = null;

  function clearRecoveryTimer(): void {
    if (recoveryTimer === null) return;
    cancel(recoveryTimer);
    recoveryTimer = null;
  }

  function assertCurrentRoute(): void {
    if (!options.isCurrent() || options.getCurrentUrl() !== options.routeUrl) {
      token = null;
      clearRecoveryTimer();
      throw new StaleOwnedStatusWriterError();
    }
  }

  async function claimOnce(): Promise<string | null> {
    assertCurrentRoute();
    let claimedToken: string | null;
    try {
      claimedToken = await options.claim();
    } catch {
      claimedToken = null;
    }
    assertCurrentRoute();
    return claimedToken;
  }

  function absorbPending(batch: WriteBatch<TValue>): void {
    if (pending === null || pending === batch) return;
    batch.value = pending.value;
    batch.version += 1;
    batch.settlements.push(...pending.settlements);
    pending = null;
  }

  function recordRecoveryExhaustion(): void {
    degraded = true;
    recoveryNotBefore = now() + nextRecoveryDelayMs;
    nextRecoveryDelayMs = Math.min(recoveryMaxDelayMs, nextRecoveryDelayMs * 2);
  }

  function resetRecoveryBackoff(): void {
    degraded = false;
    recoveryNotBefore = 0;
    nextRecoveryDelayMs = recoveryBaseDelayMs;
    clearRecoveryTimer();
  }

  async function persistBatch(batch: WriteBatch<TValue>): Promise<boolean> {
    assertCurrentRoute();
    let recoveryClaimAttempts = 0;

    if (token === null) recovering = batch;
    while (token !== null || recoveryClaimAttempts < maxClaimAttempts) {
      if (recovering === batch) absorbPending(batch);
      assertCurrentRoute();

      if (token === null) {
        recovering = batch;
        recoveryClaimAttempts += 1;
        token = await claimOnce();
        absorbPending(batch);
        if (token === null) continue;
      }

      const ownedToken = token;
      const writeVersion = batch.version;
      const writeValue = batch.value;
      try {
        await options.writeOwned(ownedToken, writeValue);
        assertCurrentRoute();
        if (batch.version !== writeVersion) continue;
        recovering = null;
        resetRecoveryBackoff();
        return true;
      } catch {
        token = null;
        absorbPending(batch);
        recovering = batch;
        assertCurrentRoute();
      }
    }

    absorbPending(batch);
    recovering = null;
    recordRecoveryExhaustion();
    return false;
  }

  function settleBatch(batch: WriteBatch<TValue>, error?: unknown): void {
    for (const settlement of batch.settlements) {
      if (error === undefined) settlement.resolve();
      else settlement.reject(error);
    }
  }

  function scheduleRecovery(): void {
    if (pending === null || recoveryTimer !== null) return;
    const delayMs = Math.max(0, recoveryNotBefore - now());
    recoveryTimer = schedule(() => {
      recoveryTimer = null;
      try {
        assertCurrentRoute();
      } catch (error) {
        const staleBatch = pending;
        pending = null;
        if (staleBatch) settleBatch(staleBatch, error);
        return;
      }
      void drain();
    }, delayMs);
  }

  function requestDrain(): void {
    if (draining || pending === null) return;
    if (now() < recoveryNotBefore) {
      scheduleRecovery();
      return;
    }
    clearRecoveryTimer();
    void drain();
  }

  async function drain(): Promise<void> {
    if (draining || pending === null) return;
    if (now() < recoveryNotBefore) {
      scheduleRecovery();
      return;
    }

    draining = true;
    try {
      while (pending !== null) {
        const batch: WriteBatch<TValue> = pending;
        pending = null;
        try {
          if (await persistBatch(batch)) {
            settleBatch(batch);
            continue;
          }

          // Keep one coalesced latest batch alive through backoff. Persistent
          // failure therefore produces one timer, not one rejection/claim per frame.
          pending = batch;
          break;
        } catch (error) {
          recovering = null;
          absorbPending(batch);
          settleBatch(batch, error);
        }
      }
    } finally {
      draining = false;
      requestDrain();
    }
  }

  function rejectQueuedForStaleRoute(error: unknown): void {
    const batches = new Set<WriteBatch<TValue>>();
    if (recovering) batches.add(recovering);
    if (pending) batches.add(pending);
    recovering = null;
    pending = null;
    for (const batch of batches) settleBatch(batch, error);
  }

  return {
    async initialize() {
      token = await claimOnce();
      if (token === null) degraded = true;
      return token !== null;
    },

    write(value) {
      try {
        assertCurrentRoute();
      } catch (error) {
        rejectQueuedForStaleRoute(error);
        return Promise.reject(error);
      }

      if (recovering !== null) {
        recovering.value = value;
        recovering.version += 1;
        return recovering.settlements.at(-1)!.promise;
      }
      if (pending !== null) {
        pending.value = value;
        pending.version += 1;
        return pending.settlements.at(-1)!.promise;
      }

      const settlement = createWriteSettlement();
      pending = { value, version: 0, settlements: [settlement] };
      requestDrain();
      return settlement.promise;
    },

    isDegraded() {
      return degraded;
    }
  };
}

function createWriteSettlement(): WriteSettlement {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.floor(value));
}
