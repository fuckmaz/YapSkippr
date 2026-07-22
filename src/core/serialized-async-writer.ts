export interface SerializedAsyncWriter<TValue> {
  write(value: TValue): Promise<void>;
}

export function createSerializedAsyncWriter<TValue>(
  writeValue: (value: TValue) => Promise<void>
): SerializedAsyncWriter<TValue> {
  let tail: Promise<void> = Promise.resolve();

  return {
    write(value) {
      const operation = tail.then(() => writeValue(value));
      tail = operation.catch(() => undefined);
      return operation;
    }
  };
}
