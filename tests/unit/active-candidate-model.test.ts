import {
  createCandidateModelCacheEnvelope,
  deriveModelEndpoint,
  loadActiveCandidateModel,
  type ActiveCandidateModelLoaderOptions
} from '../../src/core/model/active-candidate-model';
import { FEEDBACK_ENDPOINT_STORAGE_KEY, MODEL_CACHE_STORAGE_KEY } from '../../src/core/extension-settings';
import { FEATURE_SCHEMA_VERSION } from '../../src/core/model/candidate-features';
import type { CandidateModelArtifact } from '../../src/core/model/candidate-model';

const cachedModel: CandidateModelArtifact = createModel('cached-model', '2026.07.20');
const fetchedModel: CandidateModelArtifact = createModel('fetched-model', '2026.07.21');
const feedbackEndpoint = 'https://feedback.example/api/v1/feedback?source=extension#settings';
const modelEndpoint = 'https://feedback.example/api/v1/model/latest';
const matchingCache = createCandidateModelCacheEnvelope(modelEndpoint, cachedModel);

afterEach(() => {
  vi.useRealTimers();
});

test('derives the promoted-model endpoint without carrying query or hash state', () => {
  expect(deriveModelEndpoint(feedbackEndpoint)).toBe('https://feedback.example/api/v1/model/latest');
  expect(deriveModelEndpoint('https://feedback.example/custom/submit')).toBe(
    'https://feedback.example/api/v1/model/latest'
  );
});

test('fetches, validates, and caches the promoted model', async () => {
  vi.useFakeTimers();
  const fetcher = vi.fn(async () => jsonResponse(fetchedModel));
  const setStorageValue = vi.fn(async () => undefined);

  const state = await loadActiveCandidateModel(createOptions({ fetcher, setStorageValue }));

  expect(state).toMatchObject({
    model: fetchedModel,
    modelSource: 'downloaded',
    status: {
      modelId: fetchedModel.modelId,
      status: 'loaded',
      message: 'Promoted model loaded from the feedback server.'
    }
  });
  expect(fetcher).toHaveBeenCalledWith(
    'https://feedback.example/api/v1/model/latest',
    expect.objectContaining({
      method: 'GET',
      cache: 'no-store',
      credentials: 'omit',
      signal: expect.any(AbortSignal)
    })
  );
  expect(setStorageValue).toHaveBeenCalledWith(
    MODEL_CACHE_STORAGE_KEY,
    createCandidateModelCacheEnvelope(modelEndpoint, fetchedModel)
  );
  expect(vi.getTimerCount()).toBe(0);
});

test('continues to the endpoint when the cache read fails', async () => {
  const getStorageValue = storageReader({
    [MODEL_CACHE_STORAGE_KEY]: new Error('cache storage offline'),
    [FEEDBACK_ENDPOINT_STORAGE_KEY]: feedbackEndpoint
  });
  const setStorageValue = vi.fn(async () => undefined);

  const state = await loadActiveCandidateModel(createOptions({ getStorageValue, setStorageValue }));

  expect(state.model).toEqual(fetchedModel);
  expect(state.status.status).toBe('loaded');
  expect(setStorageValue).toHaveBeenCalledWith(
    MODEL_CACHE_STORAGE_KEY,
    createCandidateModelCacheEnvelope(modelEndpoint, fetchedModel)
  );
});

test('does not trust a cache when the current endpoint setting cannot be read', async () => {
  const fetcher = vi.fn(async () => jsonResponse(fetchedModel));
  const state = await loadActiveCandidateModel(createOptions({
    getStorageValue: storageReader({
      [MODEL_CACHE_STORAGE_KEY]: matchingCache,
      [FEEDBACK_ENDPOINT_STORAGE_KEY]: new Error('endpoint storage offline')
    }),
    fetcher
  }));

  expect(fetcher).not.toHaveBeenCalled();
  expectErrorFallback(state, 'Feedback endpoint settings are unavailable: endpoint storage offline');
});

test('uses heuristic error when the endpoint setting read fails without a cache', async () => {
  const fetcher = vi.fn(async () => jsonResponse(fetchedModel));
  const state = await loadActiveCandidateModel(createOptions({
    getStorageValue: storageReader({
      [MODEL_CACHE_STORAGE_KEY]: undefined,
      [FEEDBACK_ENDPOINT_STORAGE_KEY]: new Error('endpoint storage offline')
    }),
    fetcher
  }));

  expect(fetcher).not.toHaveBeenCalled();
  expectErrorFallback(state, 'Feedback endpoint settings are unavailable: endpoint storage offline');
});

test('resolves to an error fallback when both storage reads fail', async () => {
  const fetcher = vi.fn(async () => jsonResponse(fetchedModel));
  const state = await loadActiveCandidateModel(createOptions({
    getStorageValue: storageReader({
      [MODEL_CACHE_STORAGE_KEY]: new Error('cache storage offline'),
      [FEEDBACK_ENDPOINT_STORAGE_KEY]: new Error('endpoint storage offline')
    }),
    fetcher
  }));

  expect(fetcher).not.toHaveBeenCalled();
  expectErrorFallback(state, 'endpoint storage offline');
  expect(state.status.message).toContain('cache storage offline');
});

test.each([
  ['missing', undefined],
  ['empty', ''],
  ['invalid', 'file:///tmp/model.json']
])('uses heuristic confidence when the endpoint is %s and there is no cache', async (_label, endpoint) => {
  const fetcher = vi.fn(async () => jsonResponse(fetchedModel));
  const state = await loadActiveCandidateModel(createOptions({
    cache: undefined,
    endpoint,
    fetcher
  }));

  expect(fetcher).not.toHaveBeenCalled();
  expect(state).toMatchObject({
    model: null,
    modelSource: 'fallback',
    status: {
      status: 'fallback',
      message: 'No feedback endpoint configured; using heuristic confidence.'
    }
  });
});

test('uses a valid cache when no endpoint is configured', async () => {
  const fetcher = vi.fn(async () => jsonResponse(fetchedModel));
  const state = await loadActiveCandidateModel(createOptions({ endpoint: undefined, fetcher }));

  expect(fetcher).not.toHaveBeenCalled();
  expect(state.model).toEqual(cachedModel);
  expect(state.status.message).toBe('Using cached promoted model. No feedback endpoint is configured.');
});

test('keeps a legacy bare cache usable when no endpoint is configured', async () => {
  const state = await loadActiveCandidateModel(createOptions({ cache: cachedModel, endpoint: undefined }));

  expect(state.model).toEqual(cachedModel);
  expect(state.status.status).toBe('loaded');
});

test('reports cache unavailability when the cache read fails and no endpoint is configured', async () => {
  const state = await loadActiveCandidateModel(createOptions({
    getStorageValue: storageReader({
      [MODEL_CACHE_STORAGE_KEY]: new Error('cache storage offline'),
      [FEEDBACK_ENDPOINT_STORAGE_KEY]: undefined
    })
  }));

  expectErrorFallback(state, 'cache storage offline');
  expect(state.status.message).toContain('No feedback endpoint is configured');
});

describe.each([
  {
    label: 'fetch rejection',
    fetcher: async () => { throw new Error('network unavailable'); },
    expected: 'network unavailable'
  },
  {
    label: 'HTTP failure',
    fetcher: async () => new Response('', { status: 503 }),
    expected: 'HTTP 503'
  },
  {
    label: 'JSON failure',
    fetcher: async () => new Response('{not-json', {
      status: 200,
      headers: { 'content-type': 'application/json' }
    }),
    expected: 'JSON'
  },
  {
    label: 'invalid schema',
    fetcher: async () => jsonResponse({ ...fetchedModel, featureSchemaVersion: 999 }),
    expected: 'incompatible feature schema'
  }
] as const)('$label', ({ fetcher, expected }) => {
  test('resolves to the prior cache', async () => {
    const state = await loadActiveCandidateModel(createOptions({ fetcher }));

    expect(state.model).toEqual(cachedModel);
    expect(state.status.status).toBe('loaded');
    expect(state.status.message).toContain('Using cached promoted model. Latest fetch failed:');
    expect(state.status.message).toContain(expected);
  });

  test('resolves to a heuristic error without a cache', async () => {
    const state = await loadActiveCandidateModel(createOptions({ cache: undefined, fetcher }));

    expectErrorFallback(state, expected);
  });
});

test('does not use a legacy bare cache for a configured endpoint after fetch failure', async () => {
  const state = await loadActiveCandidateModel(createOptions({
    cache: cachedModel,
    fetcher: async () => { throw new Error('network unavailable'); }
  }));

  expectErrorFallback(state, 'network unavailable');
});

test('does not use an envelope from a different endpoint after fetch failure', async () => {
  const unrelatedCache = createCandidateModelCacheEnvelope(
    'https://unrelated.example/api/v1/model/latest',
    cachedModel
  );
  const state = await loadActiveCandidateModel(createOptions({
    cache: unrelatedCache,
    fetcher: async () => { throw new Error('network unavailable'); }
  }));

  expectErrorFallback(state, 'network unavailable');
});

test('migrates a legacy bare cache to a provenance envelope after a successful fetch', async () => {
  const setStorageValue = vi.fn(async () => undefined);
  const state = await loadActiveCandidateModel(createOptions({
    cache: cachedModel,
    setStorageValue
  }));

  expect(state.model).toEqual(fetchedModel);
  expect(setStorageValue).toHaveBeenCalledWith(
    MODEL_CACHE_STORAGE_KEY,
    createCandidateModelCacheEnvelope(modelEndpoint, fetchedModel)
  );
});

test('keeps the freshly fetched model active when its cache update fails over an older cache', async () => {
  const setStorageValue = vi.fn(async () => { throw new Error('cache write denied'); });
  const state = await loadActiveCandidateModel(createOptions({ setStorageValue }));

  expect(setStorageValue).toHaveBeenCalledWith(
    MODEL_CACHE_STORAGE_KEY,
    createCandidateModelCacheEnvelope(modelEndpoint, fetchedModel)
  );
  expect(state.model).toEqual(fetchedModel);
  expect(state.status.status).toBe('loaded');
  expect(state.status.message).toContain('loaded for this scan');
  expect(state.status.message).toContain('cache write denied');
});

test('keeps the freshly fetched model active when its cache update fails without a prior cache', async () => {
  const setStorageValue = vi.fn(async () => { throw new Error('cache write denied'); });
  const state = await loadActiveCandidateModel(createOptions({ cache: undefined, setStorageValue }));

  expect(state.model).toEqual(fetchedModel);
  expect(state.status.status).toBe('loaded');
  expect(state.status.message).toContain('loaded for this scan');
  expect(state.status.message).toContain('cache write denied');
});

test('skips the cache write for a stale generation', async () => {
  const setStorageValue = vi.fn(async () => undefined);
  const state = await loadActiveCandidateModel(createOptions({
    isCurrent: () => false,
    setStorageValue
  }));

  expect(setStorageValue).not.toHaveBeenCalled();
  expect(state.model).toEqual(fetchedModel);
  expect(state.status.status).toBe('loaded');
});

test('times out a never-settling fetch, aborts it, clears the timer, and resolves', async () => {
  vi.useFakeTimers();
  let requestSignal: AbortSignal | undefined;
  const fetcher = vi.fn((_input: string | URL, init?: RequestInit) => {
    requestSignal = init?.signal ?? undefined;
    return new Promise<Response>(() => undefined);
  });
  const resultPromise = loadActiveCandidateModel(createOptions({
    cache: undefined,
    fetcher,
    timeoutMs: 25
  }));

  await vi.advanceTimersByTimeAsync(25);
  const state = await resultPromise;

  expectErrorFallback(state, 'timed out after 25ms');
  expect(requestSignal?.aborted).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});

test('contains unexpected dependency failures and still resolves', async () => {
  const state = await loadActiveCandidateModel({
    getStorageValue: async () => feedbackEndpoint,
    setStorageValue: async () => undefined,
    fetcher: async () => jsonResponse(fetchedModel),
    isCurrent: () => { throw new Error('generation check exploded'); }
  });

  expectErrorFallback(state, 'generation check exploded');
});

function createOptions(overrides: Partial<ActiveCandidateModelLoaderOptions> & {
  cache?: unknown;
  endpoint?: unknown;
} = {}): ActiveCandidateModelLoaderOptions {
  const cache = Object.hasOwn(overrides, 'cache') ? overrides.cache : matchingCache;
  const endpoint = Object.hasOwn(overrides, 'endpoint') ? overrides.endpoint : feedbackEndpoint;
  return {
    getStorageValue: overrides.getStorageValue ?? storageReader({
      [MODEL_CACHE_STORAGE_KEY]: cache,
      [FEEDBACK_ENDPOINT_STORAGE_KEY]: endpoint
    }),
    setStorageValue: overrides.setStorageValue ?? (async () => undefined),
    fetcher: overrides.fetcher ?? (async () => jsonResponse(fetchedModel)),
    isCurrent: overrides.isCurrent ?? (() => true),
    timeoutMs: overrides.timeoutMs
  };
}

function storageReader(values: Record<string, unknown>): ActiveCandidateModelLoaderOptions['getStorageValue'] {
  return vi.fn(async (key: string) => {
    const value = values[key];
    if (value instanceof Error) throw value;
    return value;
  });
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });
}

function createModel(modelId: string, modelVersion: string): CandidateModelArtifact {
  return {
    modelId,
    modelVersion,
    featureSchemaVersion: FEATURE_SCHEMA_VERSION,
    createdAt: '2026-07-21T08:00:00.000Z',
    promotedAt: '2026-07-21T09:00:00.000Z',
    intercept: -1,
    weights: { heuristicConfidence: 2 },
    thresholds: { positive: 0.65, review: 0.45 },
    metrics: { auc: 0.8 },
    trainingSetSummary: { examples: 100 }
  };
}

function expectErrorFallback(
  state: Awaited<ReturnType<typeof loadActiveCandidateModel>>,
  expectedMessage: string
): void {
  expect(state.model).toBeNull();
  expect(state.modelSource).toBe('fallback');
  expect(state.status.status).toBe('error');
  expect(state.status.message).toContain(expectedMessage);
}
