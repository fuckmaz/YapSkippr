import {
  startScreenshotFrameSampler,
  calculateScreenshotCrop,
  calculateSampledFrameDimensions,
  isCapturePermissionMissingError,
  isVideoElementDisconnectedError
} from '../../src/core/analysis/frame-sampler';

test('calculates screenshot crop from video rect and screenshot dimensions', () => {
  const crop = calculateScreenshotCrop(
    { left: 10, top: 20, width: 640, height: 360 },
    { width: 1280, height: 720 },
    { width: 2560, height: 1440 }
  );

  expect(crop).toEqual({
    sourceX: 20,
    sourceY: 40,
    sourceWidth: 1280,
    sourceHeight: 720
  });
});

test('clamps screenshot crop to viewport bounds', () => {
  const crop = calculateScreenshotCrop(
    { left: -10, top: 20, width: 650, height: 360 },
    { width: 640, height: 480 },
    { width: 1280, height: 960 }
  );

  expect(crop).toEqual({
    sourceX: 0,
    sourceY: 40,
    sourceWidth: 1280,
    sourceHeight: 720
  });
});

test('rejects an extreme clipped sliver instead of manufacturing a one-pixel crop', () => {
  expect(() => calculateScreenshotCrop(
    { left: 1279.5, top: 20, width: 640, height: 360 },
    { width: 1280, height: 720 },
    { width: 2560, height: 1440 }
  )).toThrow('outside the usable viewport area');
});

test('caps sampled frame aspect ratio, output height, and total pixels before allocation', () => {
  expect(() => calculateSampledFrameDimensions({
    sourceX: 0,
    sourceY: 0,
    sourceWidth: 2,
    sourceHeight: 10_000
  }, 960)).toThrow('aspect-ratio safety limit');

  expect(() => calculateSampledFrameDimensions({
    sourceX: 0,
    sourceY: 0,
    sourceWidth: 1_000,
    sourceHeight: 2_200
  }, 1_000)).toThrow('safe canvas dimensions');

  expect(calculateSampledFrameDimensions({
    sourceX: 0,
    sourceY: 0,
    sourceWidth: 1_920,
    sourceHeight: 1_080
  }, 1_920)).toEqual({ width: 1_920, height: 1_080 });
});

test('does not allocate a canvas for an unusable clipped video rectangle', async () => {
  const scheduled: ScheduledTick[] = [];
  const createElement = vi.fn();
  vi.stubGlobal('document', { visibilityState: 'visible', createElement });
  vi.stubGlobal('window', createScheduledWindow(scheduled));
  vi.stubGlobal('Image', createLoadedImageClass(1280, 720));
  vi.stubGlobal('chrome', {
    runtime: {
      sendMessage: vi.fn((_message, callback) => callback({
        ok: true,
        dataUrl: 'data:image/png;base64,captured'
      }))
    }
  });

  const onError = vi.fn();
  const stop = startScreenshotFrameSampler({
    isConnected: true,
    currentTime: 12,
    getBoundingClientRect: () => ({ left: 1279.5, top: 20, width: 640, height: 360 })
  } as unknown as HTMLVideoElement, {
    width: 960,
    sampleIntervalMs: 1000,
    onFrame: vi.fn(),
    onError
  });

  await flushSamplerWork();

  expect(onError).toHaveBeenCalledWith(expect.objectContaining({
    message: 'Video rectangle is outside the usable viewport area.'
  }));
  expect(createElement).not.toHaveBeenCalled();
  expect(scheduled.map(({ delay }) => delay)).toEqual([1000]);

  stop();
  vi.unstubAllGlobals();
});

test('backs repeated generic capture failures off to a bounded cooldown', async () => {
  const scheduled: ScheduledTick[] = [];
  const runtime = {
    sendMessage: vi.fn((_message, callback) => callback({ ok: false, error: 'Canvas decode failed.' }))
  };
  vi.stubGlobal('document', { visibilityState: 'visible' });
  vi.stubGlobal('window', createScheduledWindow(scheduled));
  vi.stubGlobal('chrome', { runtime });

  const stop = startScreenshotFrameSampler({ isConnected: true } as HTMLVideoElement, {
    width: 320,
    sampleIntervalMs: 1000,
    onFrame: vi.fn(),
    onError: vi.fn()
  });

  await flushSamplerWork();
  const delays: number[] = [];
  for (let retry = 0; retry < 7; retry += 1) {
    const next = scheduled.shift();
    expect(next).toBeDefined();
    delays.push(next!.delay);
    next!.callback();
    await flushSamplerWork();
  }
  delays.push(scheduled[0]!.delay);

  expect(runtime.sendMessage).toHaveBeenCalledTimes(8);
  expect(scheduled.map(({ delay }) => delay)).toEqual([60_000]);
  expect(delays).toEqual([
    1000,
    2000,
    4000,
    8000,
    16_000,
    32_000,
    60_000,
    60_000
  ]);

  stop();
  vi.unstubAllGlobals();
});

test('a successful frame resets the generic failure backoff', async () => {
  const scheduled: ScheduledTick[] = [];
  const outcomes = ['fail', 'fail', 'success', 'fail'] as const;
  let captureIndex = 0;
  const runtime = {
    sendMessage: vi.fn((_message, callback) => {
      const outcome = outcomes[captureIndex++];
      callback(outcome === 'success'
        ? { ok: true, dataUrl: 'data:image/png;base64,captured' }
        : { ok: false, error: 'Canvas decode failed.' });
    })
  };
  const context = createCanvasContext();
  vi.stubGlobal('document', {
    visibilityState: 'visible',
    createElement: vi.fn(() => ({ width: 0, height: 0, getContext: () => context }))
  });
  vi.stubGlobal('window', createScheduledWindow(scheduled));
  vi.stubGlobal('Image', createLoadedImageClass(1280, 720));
  vi.stubGlobal('chrome', { runtime });

  const onFrame = vi.fn();
  const stop = startScreenshotFrameSampler(createVisibleVideo(), {
    width: 320,
    sampleIntervalMs: 1000,
    onFrame,
    onError: vi.fn()
  });

  await flushSamplerWork();
  const delays: number[] = [];
  for (let retry = 0; retry < 3; retry += 1) {
    const next = scheduled.shift();
    expect(next).toBeDefined();
    delays.push(next!.delay);
    next!.callback();
    await flushSamplerWork();
  }
  delays.push(scheduled[0]!.delay);

  expect(onFrame).toHaveBeenCalledTimes(1);
  expect(delays).toEqual([1000, 2000, 1000, 1000]);

  stop();
  vi.unstubAllGlobals();
});

test('stops retrying when extension context is invalidated', async () => {
  vi.useFakeTimers();
  const setTimeoutSpy = vi.fn(() => 123);
  vi.stubGlobal('document', { visibilityState: 'visible' });
  vi.stubGlobal('window', {
    setTimeout: setTimeoutSpy,
    clearTimeout: vi.fn()
  });
  const runtime = createRuntimeMessageError('Extension context invalidated.');
  vi.stubGlobal('chrome', { runtime });

  const onError = vi.fn();
  const video = { isConnected: true } as HTMLVideoElement;

  startScreenshotFrameSampler(video, {
    width: 320,
    sampleIntervalMs: 1000,
    onFrame: vi.fn(),
    onError
  });

  await vi.runAllTicks();
  await Promise.resolve();

  expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'Extension context invalidated.' }));
  expect(setTimeoutSpy).not.toHaveBeenCalled();

  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test('recognizes Chrome capture permission errors', () => {
  expect(
    isCapturePermissionMissingError(
      new Error("Either the '<all_urls>' or 'activeTab' permission is required.")
    )
  ).toBe(true);
});

test('stops retrying when capture permission is missing', async () => {
  vi.useFakeTimers();
  const setTimeoutSpy = vi.fn(() => 123);
  vi.stubGlobal('document', { visibilityState: 'visible' });
  vi.stubGlobal('window', {
    setTimeout: setTimeoutSpy,
    clearTimeout: vi.fn()
  });
  const runtime = createRuntimeMessageError("Either the '<all_urls>' or 'activeTab' permission is required.");
  vi.stubGlobal('chrome', { runtime });

  const onError = vi.fn();
  const video = { isConnected: true } as HTMLVideoElement;

  startScreenshotFrameSampler(video, {
    width: 320,
    sampleIntervalMs: 1000,
    onFrame: vi.fn(),
    onError
  });

  await vi.runAllTicks();
  await Promise.resolve();

  expect(onError).toHaveBeenCalledWith(
    expect.objectContaining({ message: "Either the '<all_urls>' or 'activeTab' permission is required." })
  );
  expect(setTimeoutSpy).not.toHaveBeenCalled();

  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test('reports initial video detachment as a terminal sampler error', async () => {
  const setTimeoutSpy = vi.fn(() => 123);
  vi.stubGlobal('document', { visibilityState: 'visible' });
  vi.stubGlobal('window', {
    setTimeout: setTimeoutSpy,
    clearTimeout: vi.fn()
  });

  const onError = vi.fn();
  const video = { isConnected: false } as HTMLVideoElement;
  startScreenshotFrameSampler(video, {
    width: 320,
    sampleIntervalMs: 1000,
    onFrame: vi.fn(),
    onError
  });

  await Promise.resolve();
  await Promise.resolve();

  expect(onError).toHaveBeenCalledTimes(1);
  expect(isVideoElementDisconnectedError(onError.mock.calls[0]?.[0])).toBe(true);
  expect(setTimeoutSpy).not.toHaveBeenCalled();

  vi.unstubAllGlobals();
});

test('reports a detached video even while the document is hidden', async () => {
  const setTimeoutSpy = vi.fn(() => 123);
  const sendMessage = vi.fn();
  vi.stubGlobal('document', { visibilityState: 'hidden' });
  vi.stubGlobal('window', {
    setTimeout: setTimeoutSpy,
    clearTimeout: vi.fn()
  });
  vi.stubGlobal('chrome', { runtime: { sendMessage } });

  const onError = vi.fn();
  startScreenshotFrameSampler({ isConnected: false } as HTMLVideoElement, {
    width: 320,
    sampleIntervalMs: 1000,
    onFrame: vi.fn(),
    onError
  });

  await Promise.resolve();
  await Promise.resolve();

  expect(onError).toHaveBeenCalledTimes(1);
  expect(isVideoElementDisconnectedError(onError.mock.calls[0]?.[0])).toBe(true);
  expect(sendMessage).not.toHaveBeenCalled();
  expect(setTimeoutSpy).not.toHaveBeenCalled();

  vi.unstubAllGlobals();
});

test('stops without decoding or rescheduling when the video detaches during capture', async () => {
  let captureCallback: ((response: { ok: boolean; dataUrl: string }) => void) | undefined;
  const setTimeoutSpy = vi.fn(() => 123);
  const sendMessage = vi.fn((_message, callback) => {
    captureCallback = callback;
  });
  vi.stubGlobal('document', { visibilityState: 'visible' });
  vi.stubGlobal('window', {
    setTimeout: setTimeoutSpy,
    clearTimeout: vi.fn()
  });
  vi.stubGlobal('chrome', {
    runtime: {
      sendMessage
    }
  });

  const onFrame = vi.fn();
  const onError = vi.fn();
  const video = { isConnected: true } as HTMLVideoElement;
  startScreenshotFrameSampler(video, {
    width: 320,
    sampleIntervalMs: 1000,
    onFrame,
    onError
  });

  expect(sendMessage).toHaveBeenCalledTimes(1);
  Object.assign(video, { isConnected: false });
  captureCallback?.({ ok: true, dataUrl: 'data:image/png;base64,unused' });
  await Promise.resolve();
  await Promise.resolve();

  expect(onError).toHaveBeenCalledTimes(1);
  expect(isVideoElementDisconnectedError(onError.mock.calls[0]?.[0])).toBe(true);
  expect(onFrame).not.toHaveBeenCalled();
  expect(setTimeoutSpy).not.toHaveBeenCalled();

  vi.unstubAllGlobals();
});

test('ignores an in-flight capture after the sampler is stopped', async () => {
  let captureCallback: ((response: { ok: boolean; dataUrl: string }) => void) | undefined;
  const setTimeoutSpy = vi.fn(() => 123);
  const sendMessage = vi.fn((_message, callback) => {
    captureCallback = callback;
  });
  vi.stubGlobal('document', { visibilityState: 'visible' });
  vi.stubGlobal('window', {
    setTimeout: setTimeoutSpy,
    clearTimeout: vi.fn()
  });
  vi.stubGlobal('chrome', {
    runtime: {
      sendMessage
    }
  });

  const onFrame = vi.fn();
  const onError = vi.fn();
  const video = { isConnected: true } as HTMLVideoElement;
  const stop = startScreenshotFrameSampler(video, {
    width: 320,
    sampleIntervalMs: 1000,
    onFrame,
    onError
  });

  expect(sendMessage).toHaveBeenCalledTimes(1);
  stop();
  captureCallback?.({ ok: true, dataUrl: 'data:image/png;base64,unused' });
  await Promise.resolve();
  await Promise.resolve();

  expect(onFrame).not.toHaveBeenCalled();
  expect(onError).not.toHaveBeenCalled();
  expect(setTimeoutSpy).not.toHaveBeenCalled();

  vi.unstubAllGlobals();
});

test('suppresses an in-flight capture error after the sampler is stopped', async () => {
  let captureCallback: (() => void) | undefined;
  const setTimeoutSpy = vi.fn(() => 123);
  const runtime = {
    lastError: undefined as { message: string } | undefined,
    sendMessage: vi.fn((_message, callback) => {
      captureCallback = () => {
        runtime.lastError = { message: 'Capture finished after cancellation.' };
        callback();
        runtime.lastError = undefined;
      };
    })
  };
  vi.stubGlobal('document', { visibilityState: 'visible' });
  vi.stubGlobal('window', {
    setTimeout: setTimeoutSpy,
    clearTimeout: vi.fn()
  });
  vi.stubGlobal('chrome', { runtime });

  const onFrame = vi.fn();
  const onError = vi.fn();
  const video = { isConnected: true } as HTMLVideoElement;
  const stop = startScreenshotFrameSampler(video, {
    width: 320,
    sampleIntervalMs: 1000,
    onFrame,
    onError
  });

  expect(runtime.sendMessage).toHaveBeenCalledTimes(1);
  stop();
  captureCallback?.();
  await Promise.resolve();
  await Promise.resolve();

  expect(onFrame).not.toHaveBeenCalled();
  expect(onError).not.toHaveBeenCalled();
  expect(setTimeoutSpy).not.toHaveBeenCalled();

  vi.unstubAllGlobals();
});

function createRuntimeMessageError(message: string): {
  lastError: { message: string } | undefined;
  sendMessage: ReturnType<typeof vi.fn>;
} {
  const runtime = {
    lastError: undefined as { message: string } | undefined,
    sendMessage: vi.fn((_message, callback) => {
      runtime.lastError = { message };
      callback();
      runtime.lastError = undefined;
    })
  };
  return runtime;
}

interface ScheduledTick {
  callback(): void;
  delay: number;
}

function createScheduledWindow(scheduled: ScheduledTick[]): {
  innerWidth: number;
  innerHeight: number;
  setTimeout(callback: TimerHandler, delay?: number): number;
  clearTimeout: ReturnType<typeof vi.fn>;
} {
  return {
    innerWidth: 1280,
    innerHeight: 720,
    setTimeout(callback, delay = 0) {
      if (typeof callback !== 'function') throw new Error('Expected a scheduled function.');
      scheduled.push({ callback: callback as () => void, delay });
      return scheduled.length;
    },
    clearTimeout: vi.fn()
  };
}

function createLoadedImageClass(naturalWidth: number, naturalHeight: number): typeof Image {
  return class LoadedImage {
    naturalWidth = naturalWidth;
    naturalHeight = naturalHeight;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;

    set src(_value: string) {
      this.onload?.();
    }
  } as unknown as typeof Image;
}

function createCanvasContext(): CanvasRenderingContext2D {
  return {
    drawImage: vi.fn(),
    getImageData: vi.fn(() => ({
      width: 320,
      height: 180,
      data: new Uint8ClampedArray(320 * 180 * 4),
      colorSpace: 'srgb'
    } as ImageData)),
    imageSmoothingEnabled: false,
    imageSmoothingQuality: 'low'
  } as unknown as CanvasRenderingContext2D;
}

function createVisibleVideo(): HTMLVideoElement {
  return {
    isConnected: true,
    currentTime: 12,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 })
  } as unknown as HTMLVideoElement;
}

async function flushSamplerWork(): Promise<void> {
  for (let step = 0; step < 8; step += 1) await Promise.resolve();
}
