import { createLatestAsyncControl } from '../../src/core/latest-async-control';
import type { Mock } from 'vitest';

interface TestControl {
  stop: Mock<() => void>;
}

test('keeps the latest control when overlapping boots resolve out of order', async () => {
  const coordinator = createLatestAsyncControl<TestControl>();
  const firstResult = deferred<TestControl>();
  const secondResult = deferred<TestControl>();
  const firstControl = createControl();
  const secondControl = createControl();
  let firstIsCurrent: (() => boolean) | undefined;

  const firstBoot = coordinator.replace((isCurrent) => {
    firstIsCurrent = isCurrent;
    return firstResult.promise;
  });
  expect(firstIsCurrent?.()).toBe(true);
  const secondBoot = coordinator.replace(() => secondResult.promise);
  expect(firstIsCurrent?.()).toBe(false);

  secondResult.resolve(secondControl);
  await secondBoot;
  expect(coordinator.getCurrent()).toBe(secondControl);

  firstResult.resolve(firstControl);
  await firstBoot;

  expect(firstControl.stop).toHaveBeenCalledTimes(1);
  expect(secondControl.stop).not.toHaveBeenCalled();
  expect(coordinator.getCurrent()).toBe(secondControl);
});

test('stops a control returned after the coordinator was stopped', async () => {
  const coordinator = createLatestAsyncControl<TestControl>();
  const pendingResult = deferred<TestControl>();
  const pendingControl = createControl();
  let isCurrent: (() => boolean) | undefined;

  const boot = coordinator.replace((checkCurrent) => {
    isCurrent = checkCurrent;
    return pendingResult.promise;
  });
  expect(isCurrent?.()).toBe(true);

  coordinator.stop();
  expect(isCurrent?.()).toBe(false);

  pendingResult.resolve(pendingControl);
  await boot;

  expect(pendingControl.stop).toHaveBeenCalledTimes(1);
  expect(coordinator.getCurrent()).toBeUndefined();
});

test('stops the active control before starting its replacement', async () => {
  const coordinator = createLatestAsyncControl<TestControl>();
  let firstIsCurrent: (() => boolean) | undefined;
  let firstWasInvalidatedBeforeStop = false;
  const firstControl: TestControl = {
    stop: vi.fn(() => {
      firstWasInvalidatedBeforeStop = firstIsCurrent?.() === false;
    })
  };
  const secondControl = createControl();

  await coordinator.replace(async (isCurrent) => {
    firstIsCurrent = isCurrent;
    return firstControl;
  });
  expect(coordinator.getCurrent()).toBe(firstControl);

  let firstWasStoppedBeforeFactory = false;
  await coordinator.replace(async () => {
    firstWasStoppedBeforeFactory = firstControl.stop.mock.calls.length === 1;
    return secondControl;
  });

  expect(firstWasStoppedBeforeFactory).toBe(true);
  expect(firstWasInvalidatedBeforeStop).toBe(true);
  expect(firstControl.stop).toHaveBeenCalledTimes(1);
  expect(coordinator.getCurrent()).toBe(secondControl);
});

test('keeps the current generation valid during terminal stop and invalidates it afterward', async () => {
  const coordinator = createLatestAsyncControl<TestControl>();
  let isCurrent: (() => boolean) | undefined;
  let wasCurrentDuringStop = false;
  const control: TestControl = {
    stop: vi.fn(() => {
      wasCurrentDuringStop = isCurrent?.() === true && coordinator.getCurrent() === control;
    })
  };

  await coordinator.replace(async (checkCurrent) => {
    isCurrent = checkCurrent;
    return control;
  });

  coordinator.stop();

  expect(wasCurrentDuringStop).toBe(true);
  expect(isCurrent?.()).toBe(false);
  expect(coordinator.getCurrent()).toBeUndefined();
});

test('invalidates terminal stop in finally when the active control throws', async () => {
  const coordinator = createLatestAsyncControl<TestControl>();
  let isCurrent: (() => boolean) | undefined;
  const control: TestControl = {
    stop: vi.fn(() => {
      throw new Error('stop failed');
    })
  };

  await coordinator.replace(async (checkCurrent) => {
    isCurrent = checkCurrent;
    return control;
  });

  expect(() => coordinator.stop()).toThrow('stop failed');
  expect(isCurrent?.()).toBe(false);
  expect(coordinator.getCurrent()).toBeUndefined();
});

test('installs a replacement even when the previous control throws while stopping', async () => {
  const coordinator = createLatestAsyncControl<TestControl>();
  const firstControl: TestControl = {
    stop: vi.fn(() => {
      throw new Error('previous cleanup failed');
    })
  };
  const secondControl = createControl();
  let replacementFactoryCalled = false;

  await coordinator.replace(async () => firstControl);
  const replacement = coordinator.replace(async () => {
    replacementFactoryCalled = true;
    return secondControl;
  });

  await expect(replacement).rejects.toThrow('previous cleanup failed');
  expect(replacementFactoryCalled).toBe(true);
  expect(coordinator.getCurrent()).toBe(secondControl);
});

test('an immediate video-replacement boot invalidates a scan whose factory is still pending', async () => {
  const coordinator = createLatestAsyncControl<TestControl>();
  const staleControl = createControl();
  const replacementControl = createControl();
  let replacementBoot: Promise<void> | undefined;
  let staleFactoryWasInvalidated = false;

  const staleBoot = coordinator.replace(async (isCurrent) => {
    replacementBoot = coordinator.replace(async () => replacementControl);
    staleFactoryWasInvalidated = !isCurrent();
    return staleControl;
  });

  await staleBoot;
  await replacementBoot;

  expect(staleFactoryWasInvalidated).toBe(true);
  expect(staleControl.stop).toHaveBeenCalledTimes(1);
  expect(replacementControl.stop).not.toHaveBeenCalled();
  expect(coordinator.getCurrent()).toBe(replacementControl);
});

function createControl(): TestControl {
  return { stop: vi.fn() };
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
