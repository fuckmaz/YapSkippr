import type { ScanStatusPhase } from './scan-status';

export interface ScanCapabilityProbeResult {
  ok: boolean;
  ready: boolean;
  error?: string;
}

export interface ScanCapabilityInput {
  tabId: number;
  sessionKey: string;
  phase: ScanStatusPhase;
}

export interface ScanCapabilityViewState {
  enabled: boolean;
  message?: string;
}

export interface ScanCapabilityController {
  update(input: ScanCapabilityInput): void;
  dispose(): void;
}

export interface ScanCapabilityControllerOptions {
  probe(tabId: number): Promise<ScanCapabilityProbeResult>;
  render(state: ScanCapabilityViewState): void;
  retryDelayMs?: number;
  cooldownRetryDelayMs?: number;
  maxProbeAttempts?: number;
  schedule?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  cancel?: (timer: ReturnType<typeof setTimeout>) => void;
}

export function createScanCapabilityController(
  options: ScanCapabilityControllerOptions
): ScanCapabilityController {
  const retryDelayMs = normalizePositiveInteger(options.retryDelayMs, 750);
  const cooldownRetryDelayMs = normalizePositiveInteger(options.cooldownRetryDelayMs, 5_000);
  const maxProbeAttempts = normalizePositiveInteger(options.maxProbeAttempts, 3);
  const schedule = options.schedule ?? ((callback, delayMs) => setTimeout(callback, delayMs));
  const cancel = options.cancel ?? ((timer) => clearTimeout(timer));
  let current: ScanCapabilityInput | null = null;
  let generation = 0;
  let attempts = 0;
  let ready = false;
  let probing = false;
  let disposed = false;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let lastView: ScanCapabilityViewState | null = null;

  function render(state: ScanCapabilityViewState): void {
    lastView = state;
    options.render(state);
  }

  function clearRetry(): void {
    if (retryTimer === null) return;
    cancel(retryTimer);
    retryTimer = null;
  }

  function resetProbeState(): void {
    generation += 1;
    attempts = 0;
    ready = false;
    probing = false;
    lastView = null;
    clearRetry();
  }

  function isCurrent(expectedGeneration: number, input: ScanCapabilityInput): boolean {
    return !disposed
      && generation === expectedGeneration
      && current?.tabId === input.tabId
      && current.sessionKey === input.sessionKey
      && current.phase === input.phase;
  }

  function scheduleRetry(input: ScanCapabilityInput, expectedGeneration: number): void {
    if (retryTimer !== null || !isCurrent(expectedGeneration, input)) return;
    const reopenBudget = attempts >= maxProbeAttempts;
    retryTimer = schedule(() => {
      retryTimer = null;
      if (!isCurrent(expectedGeneration, input)) return;
      if (reopenBudget) attempts = 0;
      void runProbe(input, expectedGeneration);
    }, reopenBudget ? cooldownRetryDelayMs : retryDelayMs);
  }

  async function runProbe(input: ScanCapabilityInput, expectedGeneration: number): Promise<void> {
    if (probing || attempts >= maxProbeAttempts || !isCurrent(expectedGeneration, input)) return;
    probing = true;
    attempts += 1;

    try {
      const response = await options.probe(input.tabId);
      if (!isCurrent(expectedGeneration, input)) return;
      if (response.ok && response.ready) {
        ready = true;
        clearRetry();
        render({ enabled: true });
        return;
      }

      render({
        enabled: false,
        message: response.error ?? 'The selected visual-check interval is not ready in this tab.'
      });
      scheduleRetry(input, expectedGeneration);
    } catch (error) {
      if (!isCurrent(expectedGeneration, input)) return;
      const message = error instanceof Error ? error.message : String(error);
      render({ enabled: false, message: `Visual-check interval unavailable: ${message}` });
      scheduleRetry(input, expectedGeneration);
    } finally {
      if (isCurrent(expectedGeneration, input)) probing = false;
    }
  }

  return {
    update(input) {
      if (disposed) return;
      const transitioned = current === null
        || current.tabId !== input.tabId
        || current.sessionKey !== input.sessionKey
        || current.phase !== input.phase;
      current = input;
      if (transitioned) resetProbeState();

      if (!isProbeEligiblePhase(input.phase)) {
        if (transitioned || lastView === null) {
          render({
            enabled: false,
            message: input.phase === 'starting'
              ? 'Interval controls will be available when the player is ready.'
              : 'Interval controls are available while detection is running.'
          });
        } else {
          options.render(lastView);
        }
        return;
      }

      if (ready) {
        options.render(lastView ?? { enabled: true });
        return;
      }
      if (probing || retryTimer !== null) {
        if (lastView) options.render(lastView);
        return;
      }
      if (attempts >= maxProbeAttempts) {
        if (lastView) options.render(lastView);
        return;
      }
      render({ enabled: false, message: 'Checking visual-check interval support...' });
      void runProbe(input, generation);
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      resetProbeState();
      current = null;
    }
  };
}

export function createScanCapabilitySessionKey(input: {
  tabId: number;
  platformId: string | null;
  videoId: string | null;
  pageUrl: string | null;
}): string {
  return [input.tabId, input.platformId ?? '', input.videoId ?? '', input.pageUrl ?? ''].join('\u001f');
}

function isProbeEligiblePhase(phase: ScanStatusPhase): boolean {
  return phase === 'transcript' || phase === 'frames' || phase === 'fusion';
}

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.floor(value));
}
