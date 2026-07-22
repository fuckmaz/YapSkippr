import { FEEDBACK_ENDPOINT_STORAGE_KEY, MODEL_CACHE_STORAGE_KEY } from '../extension-settings';
import { normalizeFeedbackEndpoint } from '../feedback';
import { createFallbackModelState, type ScanStatusModelState } from '../scan-status';
import {
  validateCandidateModel,
  type CandidateModelArtifact,
  type CandidateModelSource
} from './candidate-model';

export const DEFAULT_MODEL_FETCH_TIMEOUT_MS = 5_000;
export const CANDIDATE_MODEL_CACHE_FORMAT_VERSION = 1;

export interface CandidateModelCacheEnvelope {
  formatVersion: typeof CANDIDATE_MODEL_CACHE_FORMAT_VERSION;
  modelEndpoint: string;
  artifact: CandidateModelArtifact;
}

export interface ActiveCandidateModelState {
  model: CandidateModelArtifact | null;
  modelSource: CandidateModelSource;
  status: ScanStatusModelState;
}

export interface ActiveCandidateModelLoaderOptions {
  getStorageValue(key: string): Promise<unknown>;
  setStorageValue(key: string, value: unknown): Promise<void>;
  fetcher(input: string | URL, init?: RequestInit): Promise<Response>;
  isCurrent(): boolean;
  timeoutMs?: number;
}

interface StorageReadResult {
  value: unknown;
  error: string | null;
}

interface StoredCandidateModel {
  artifact: CandidateModelArtifact;
  modelEndpoint: string | null;
}

/**
 * Loads the promoted candidate model without allowing extension storage or
 * network failures to reject scan startup.
 */
export async function loadActiveCandidateModel(
  options: ActiveCandidateModelLoaderOptions
): Promise<ActiveCandidateModelState> {
  try {
    return await loadActiveCandidateModelSafely(options);
  } catch (error) {
    return createModelErrorState(`Unexpected model startup failure: ${errorMessage(error)}`);
  }
}

async function loadActiveCandidateModelSafely(
  options: ActiveCandidateModelLoaderOptions
): Promise<ActiveCandidateModelState> {
  const [cacheRead, endpointRead] = await Promise.all([
    readStorageValue(options.getStorageValue, MODEL_CACHE_STORAGE_KEY),
    readStorageValue(options.getStorageValue, FEEDBACK_ENDPOINT_STORAGE_KEY)
  ]);
  const storedModel = cacheRead.error === null ? parseStoredCandidateModel(cacheRead.value) : null;

  if (endpointRead.error !== null) {
    const cacheDetail = cacheRead.error === null ? '' : ` Cached model storage is unavailable: ${cacheRead.error}.`;
    return createModelErrorState(
      `Model unavailable: Feedback endpoint settings are unavailable: ${endpointRead.error}.${cacheDetail}`
    );
  }

  const feedbackEndpoint = normalizeStoredFeedbackEndpoint(endpointRead.value);
  if (!feedbackEndpoint) {
    if (storedModel) {
      return createLoadedActiveCandidateModel(
        storedModel.artifact,
        'downloaded',
        'Using cached promoted model. No feedback endpoint is configured.'
      );
    }
    if (cacheRead.error !== null) {
      return createModelErrorState(
        `Cached model storage is unavailable: ${cacheRead.error}. No feedback endpoint is configured.`
      );
    }
    return createFallbackActiveCandidateModel('No feedback endpoint configured; using heuristic confidence.');
  }

  const modelEndpoint = deriveModelEndpoint(feedbackEndpoint);
  const matchingCachedModel = storedModel?.modelEndpoint === modelEndpoint ? storedModel.artifact : null;
  try {
    const rawModel = await fetchModelArtifact(
      modelEndpoint,
      options.fetcher,
      normalizeTimeout(options.timeoutMs)
    );
    const model = validateCandidateModel(rawModel);
    if (!model) throw new Error('Model artifact is missing required fields or uses an incompatible feature schema.');

    if (options.isCurrent()) {
      try {
        await options.setStorageValue(MODEL_CACHE_STORAGE_KEY, createCandidateModelCacheEnvelope(modelEndpoint, model));
      } catch (error) {
        return createLoadedActiveCandidateModel(
          model,
          'downloaded',
          `Promoted model loaded for this scan, but its cache could not be updated: ${errorMessage(error)}`
        );
      }
    }

    return createLoadedActiveCandidateModel(
      model,
      'downloaded',
      'Promoted model loaded from the feedback server.'
    );
  } catch (error) {
    return fallbackAfterFailure(matchingCachedModel, errorMessage(error), cacheRead.error);
  }
}

async function readStorageValue(
  getStorageValue: ActiveCandidateModelLoaderOptions['getStorageValue'],
  key: string
): Promise<StorageReadResult> {
  try {
    return { value: await getStorageValue(key), error: null };
  } catch (error) {
    return { value: undefined, error: errorMessage(error) };
  }
}

async function fetchModelArtifact(
  endpoint: string,
  fetcher: ActiveCandidateModelLoaderOptions['fetcher'],
  timeoutMs: number
): Promise<unknown> {
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(() => {
      controller.abort();
      reject(new Error(`Model request timed out after ${timeoutMs}ms.`));
    }, timeoutMs);
  });
  const request = Promise.resolve().then(async () => {
    const response = await fetcher(endpoint, {
      method: 'GET',
      headers: { accept: 'application/json' },
      cache: 'no-store',
      credentials: 'omit',
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`Model endpoint returned HTTP ${response.status}.`);
    return response.json() as Promise<unknown>;
  });

  try {
    return await Promise.race([request, timeout]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

function fallbackAfterFailure(
  cachedModel: CandidateModelArtifact | null,
  failure: string,
  cacheReadError: string | null
): ActiveCandidateModelState {
  if (cachedModel) {
    return createLoadedActiveCandidateModel(
      cachedModel,
      'downloaded',
      `Using cached promoted model. Latest fetch failed: ${failure}`
    );
  }

  const cacheDetail = cacheReadError === null ? '' : ` Cached model storage is unavailable: ${cacheReadError}.`;
  return createModelErrorState(`Model unavailable: ${failure}${cacheDetail}`);
}

export function createLoadedActiveCandidateModel(
  model: CandidateModelArtifact,
  modelSource: CandidateModelSource,
  message: string
): ActiveCandidateModelState {
  return {
    model,
    modelSource,
    status: {
      modelId: model.modelId,
      modelVersion: model.modelVersion,
      modelSource,
      featureSchemaVersion: model.featureSchemaVersion,
      status: 'loaded',
      message
    }
  };
}

export function createFallbackActiveCandidateModel(message: string): ActiveCandidateModelState {
  return {
    model: null,
    modelSource: 'fallback',
    status: createFallbackModelState(message)
  };
}

export function createCandidateModelCacheEnvelope(
  modelEndpoint: string,
  artifact: CandidateModelArtifact
): CandidateModelCacheEnvelope {
  return {
    formatVersion: CANDIDATE_MODEL_CACHE_FORMAT_VERSION,
    modelEndpoint,
    artifact
  };
}

export function deriveModelEndpoint(feedbackEndpoint: string): string {
  const url = new URL(feedbackEndpoint);
  if (/\/feedback\/?$/.test(url.pathname)) {
    url.pathname = url.pathname.replace(/\/feedback\/?$/, '/model/latest');
  } else {
    url.pathname = '/api/v1/model/latest';
  }
  url.search = '';
  url.hash = '';
  return url.toString();
}

function createModelErrorState(message: string): ActiveCandidateModelState {
  return {
    model: null,
    modelSource: 'fallback',
    status: {
      ...createFallbackModelState(message),
      status: 'error'
    }
  };
}

function normalizeStoredFeedbackEndpoint(value: unknown): string | null {
  return typeof value === 'string' ? normalizeFeedbackEndpoint(value) : null;
}

function parseStoredCandidateModel(value: unknown): StoredCandidateModel | null {
  const legacyArtifact = validateCandidateModel(value);
  if (legacyArtifact) return { artifact: legacyArtifact, modelEndpoint: null };
  if (!isRecord(value) || value.formatVersion !== CANDIDATE_MODEL_CACHE_FORMAT_VERSION) return null;

  const modelEndpoint = normalizeModelEndpoint(value.modelEndpoint);
  const artifact = validateCandidateModel(value.artifact);
  return modelEndpoint && artifact ? { artifact, modelEndpoint } : null;
}

function normalizeModelEndpoint(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = normalizeFeedbackEndpoint(value);
  if (!normalized) return null;

  const url = new URL(normalized);
  url.search = '';
  url.hash = '';
  return url.toString();
}

function normalizeTimeout(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : DEFAULT_MODEL_FETCH_TIMEOUT_MS;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
