export interface FeedbackSendLease {
  readonly consentGeneration: number;
  readonly endpoint: string;
  readonly endpointGeneration: number;
  readonly signal: AbortSignal;
}

export interface FeedbackSendControl {
  getConsentGeneration(): number;
  getEndpoint(): string | null;
  getEndpointGeneration(): number;
  isAuthorized(): boolean;
  authorizeConsentIfCurrent(generation: number): boolean;
  revokeConsent(): void;
  invalidateEndpoint(): void;
  setEndpoint(endpoint: string | null): boolean;
  setEndpointIfCurrent(generation: number, endpoint: string | null): boolean;
  isEndpointGenerationCurrent(generation: number): boolean;
  begin(): FeedbackSendLease | null;
  isCurrent(lease: FeedbackSendLease): boolean;
  assertCurrent(lease: FeedbackSendLease): void;
  finish(lease: FeedbackSendLease): void;
  dispose(): void;
}

export class FeedbackSendInvalidatedError extends Error {
  constructor() {
    super('Feedback send was cancelled because consent or endpoint access changed.');
    this.name = 'FeedbackSendInvalidatedError';
  }
}

export function createFeedbackSendControl(): FeedbackSendControl {
  let authorized = false;
  let consentGeneration = 0;
  let endpoint: string | null = null;
  let endpointGeneration = 0;
  const activeControllers = new Map<FeedbackSendLease, AbortController>();

  function abortActive(): void {
    for (const controller of activeControllers.values()) controller.abort();
    activeControllers.clear();
  }

  function isCurrent(lease: FeedbackSendLease): boolean {
    return authorized
      && endpoint !== null
      && lease.endpoint === endpoint
      && lease.consentGeneration === consentGeneration
      && lease.endpointGeneration === endpointGeneration
      && !lease.signal.aborted;
  }

  function invalidateEndpoint(): void {
    endpoint = null;
    endpointGeneration += 1;
    abortActive();
  }

  function setEndpoint(nextEndpoint: string | null): boolean {
    if (endpoint === nextEndpoint) return false;
    endpoint = nextEndpoint;
    endpointGeneration += 1;
    abortActive();
    return true;
  }

  return {
    getConsentGeneration: () => consentGeneration,
    getEndpoint: () => endpoint,
    getEndpointGeneration: () => endpointGeneration,
    isAuthorized: () => authorized,

    authorizeConsentIfCurrent(generation) {
      if (generation !== consentGeneration) return false;
      if (!authorized) {
        authorized = true;
        consentGeneration += 1;
      }
      return true;
    },

    revokeConsent() {
      authorized = false;
      consentGeneration += 1;
      abortActive();
    },

    invalidateEndpoint,

    setEndpoint,

    setEndpointIfCurrent(generation, nextEndpoint) {
      if (generation !== endpointGeneration) return false;
      setEndpoint(nextEndpoint);
      return true;
    },

    isEndpointGenerationCurrent(generation) {
      return generation === endpointGeneration;
    },

    begin() {
      if (!authorized || endpoint === null) return null;
      const controller = new AbortController();
      const lease: FeedbackSendLease = {
        consentGeneration,
        endpoint,
        endpointGeneration,
        signal: controller.signal
      };
      activeControllers.set(lease, controller);
      return lease;
    },

    isCurrent,

    assertCurrent(lease) {
      if (!isCurrent(lease)) throw new FeedbackSendInvalidatedError();
    },

    finish(lease) {
      activeControllers.delete(lease);
    },

    dispose() {
      authorized = false;
      endpoint = null;
      consentGeneration += 1;
      endpointGeneration += 1;
      abortActive();
    }
  };
}

export function isFeedbackSendInvalidatedError(error: unknown): boolean {
  return error instanceof FeedbackSendInvalidatedError
    || (error instanceof DOMException && error.name === 'AbortError');
}
