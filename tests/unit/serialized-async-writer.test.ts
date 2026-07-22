import { createSerializedAsyncWriter } from '../../src/core/serialized-async-writer';

test('executes writes in invocation order', async () => {
  const firstWrite = deferred<void>();
  const started: number[] = [];
  const writer = createSerializedAsyncWriter<number>(async (value) => {
    started.push(value);
    if (value === 1) await firstWrite.promise;
  });

  const first = writer.write(1);
  const second = writer.write(2);
  await Promise.resolve();

  expect(started).toEqual([1]);

  firstWrite.resolve(undefined);
  await Promise.all([first, second]);
  expect(started).toEqual([1, 2]);
});

test('continues with later writes after an earlier write rejects', async () => {
  const started: number[] = [];
  const writer = createSerializedAsyncWriter<number>(async (value) => {
    started.push(value);
    if (value === 1) throw new Error('write failed');
  });

  const first = writer.write(1);
  const firstRejection = expect(first).rejects.toThrow('write failed');
  const second = writer.write(2);

  await firstRejection;
  await expect(second).resolves.toBeUndefined();
  expect(started).toEqual([1, 2]);
});

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
