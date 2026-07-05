import { startScreenshotFrameSampler, calculateScreenshotCrop } from '../../src/core/analysis/frame-sampler';

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

test('stops retrying when extension context is invalidated', async () => {
  vi.useFakeTimers();
  const setTimeoutSpy = vi.fn(() => 123);
  vi.stubGlobal('document', { visibilityState: 'visible' });
  vi.stubGlobal('window', {
    setTimeout: setTimeoutSpy,
    clearTimeout: vi.fn()
  });
  vi.stubGlobal('chrome', {
    runtime: {
      sendMessage: vi.fn(async () => {
        throw new Error('Extension context invalidated.');
      })
    }
  });

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
