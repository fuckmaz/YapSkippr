import {
  createScanCapabilityController,
  createScanCapabilitySessionKey,
  type ScanCapabilityProbeResult,
  type ScanCapabilityViewState
} from '../../src/core/scan-capability-controller';

test('keeps startup disabled and retries a false readiness probe on a bounded timer', async () => {
  const scheduler = createScheduler();
  const responses: ScanCapabilityProbeResult[] = [
    { ok: true, ready: false, error: 'player mounting' },
    { ok: true, ready: true }
  ];
  const views: ScanCapabilityViewState[] = [];
  let probes = 0;
  const controller = createScanCapabilityController({
    probe: async () => {
      probes += 1;
      return responses.shift() ?? { ok: true, ready: false };
    },
    render: (view) => views.push(view),
    schedule: scheduler.schedule,
    cancel: scheduler.cancel,
    retryDelayMs: 500,
    maxProbeAttempts: 3
  });

  controller.update({ tabId: 7, sessionKey: 'video-a', phase: 'starting' });
  expect(views.at(-1)).toEqual({
    enabled: false,
    message: 'Interval controls will be available when the player is ready.'
  });
  expect(probes).toBe(0);

  controller.update({ tabId: 7, sessionKey: 'video-a', phase: 'frames' });
  await flushPromises();
  expect(probes).toBe(1);
  expect(views.at(-1)).toEqual({ enabled: false, message: 'player mounting' });

  scheduler.runNext();
  await flushPromises();
  expect(probes).toBe(2);
  expect(views.at(-1)).toEqual({ enabled: true });
});

test('invalidates ready state on phase and session transitions without repeated same-phase probes', async () => {
  const views: ScanCapabilityViewState[] = [];
  let probes = 0;
  const controller = createScanCapabilityController({
    probe: async () => {
      probes += 1;
      return { ok: true, ready: true };
    },
    render: (view) => views.push(view)
  });

  controller.update({ tabId: 7, sessionKey: 'video-a', phase: 'frames' });
  await flushPromises();
  controller.update({ tabId: 7, sessionKey: 'video-a', phase: 'frames' });
  expect(probes).toBe(1);
  expect(views.at(-1)).toEqual({ enabled: true });

  controller.update({ tabId: 7, sessionKey: 'video-a', phase: 'starting' });
  expect(views.at(-1)?.enabled).toBe(false);

  controller.update({ tabId: 7, sessionKey: 'video-b', phase: 'transcript' });
  await flushPromises();
  expect(probes).toBe(2);
  expect(views.at(-1)).toEqual({ enabled: true });
});

test('reopens the same-phase probe budget after cooldown and eventually enables', async () => {
  const scheduler = createScheduler();
  const responses: ScanCapabilityProbeResult[] = [
    { ok: true, ready: false },
    { ok: true, ready: false },
    { ok: true, ready: false },
    { ok: true, ready: true }
  ];
  const views: ScanCapabilityViewState[] = [];
  let probes = 0;
  const controller = createScanCapabilityController({
    probe: async () => {
      probes += 1;
      return responses.shift() ?? { ok: true, ready: false };
    },
    render: (view) => views.push(view),
    schedule: scheduler.schedule,
    cancel: scheduler.cancel,
    retryDelayMs: 100,
    cooldownRetryDelayMs: 2_000,
    maxProbeAttempts: 3
  });

  controller.update({ tabId: 7, sessionKey: 'video-a', phase: 'frames' });
  await flushPromises();
  scheduler.runNext();
  await flushPromises();
  scheduler.runNext();
  await flushPromises();
  expect(probes).toBe(3);
  expect(scheduler.nextDelay()).toBe(2_000);

  // Repeated status updates do not bypass the cooldown.
  controller.update({ tabId: 7, sessionKey: 'video-a', phase: 'frames' });
  expect(probes).toBe(3);
  scheduler.runNext();
  await flushPromises();
  expect(probes).toBe(4);
  expect(views.at(-1)).toEqual({ enabled: true });
  expect(scheduler.pending()).toBe(0);
});

test('cancels cooldown retries on transition and disposal', async () => {
  const scheduler = createScheduler();
  const controller = createScanCapabilityController({
    probe: async () => ({ ok: true, ready: false }),
    render: () => undefined,
    schedule: scheduler.schedule,
    cancel: scheduler.cancel,
    maxProbeAttempts: 1
  });

  controller.update({ tabId: 7, sessionKey: 'video-a', phase: 'frames' });
  await flushPromises();
  expect(scheduler.pending()).toBe(1);

  controller.update({ tabId: 7, sessionKey: 'video-a', phase: 'starting' });
  expect(scheduler.pending()).toBe(0);

  controller.update({ tabId: 7, sessionKey: 'video-b', phase: 'frames' });
  await flushPromises();
  expect(scheduler.pending()).toBe(1);
  controller.dispose();
  expect(scheduler.pending()).toBe(0);
});

test('creates stable session keys from tab and video identity', () => {
  expect(createScanCapabilitySessionKey({
    tabId: 7,
    platformId: 'youtube',
    videoId: 'abc',
    pageUrl: 'https://www.youtube.com/watch?v=abc'
  })).toBe('7\u001fyoutube\u001fabc\u001fhttps://www.youtube.com/watch?v=abc');
});

function createScheduler() {
  let nextId = 1;
  const tasks = new Map<number, { callback: () => void; delayMs: number }>();
  return {
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
      if (!next) throw new Error('No scheduled callback.');
      tasks.delete(next[0]);
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
  await Promise.resolve();
  await Promise.resolve();
}
