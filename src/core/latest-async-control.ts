export interface StoppableControl {
  stop(): void;
}

export interface LatestAsyncControl<TControl extends StoppableControl> {
  getCurrent(): TControl | undefined;
  replace(factory: (isCurrent: () => boolean) => Promise<TControl | undefined>): Promise<void>;
  stop(): void;
}

export function createLatestAsyncControl<TControl extends StoppableControl>(): LatestAsyncControl<TControl> {
  let generation = 0;
  let current: TControl | undefined;

  return {
    getCurrent() {
      return current;
    },

    async replace(factory) {
      const replacementGeneration = ++generation;
      const previous = current;
      current = undefined;
      let cleanupFailed = false;
      let cleanupError: unknown;
      try {
        previous?.stop();
      } catch (error) {
        cleanupFailed = true;
        cleanupError = error;
      }

      const next = await factory(() => generation === replacementGeneration);
      if (generation !== replacementGeneration) {
        next?.stop();
        if (cleanupFailed) throw cleanupError;
        return;
      }

      current = next;
      if (cleanupFailed) throw cleanupError;
    },

    stop() {
      const previous = current;
      try {
        previous?.stop();
      } finally {
        current = undefined;
        generation += 1;
      }
    }
  };
}
