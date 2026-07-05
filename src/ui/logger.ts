export interface Logger {
  debug(message: string, data?: unknown): void;
  info(message: string, data?: unknown): void;
  warn(message: string, data?: unknown): void;
  error(message: string, data?: unknown): void;
}

export function createLogger(scope: string): Logger {
  const prefix = `[YapSkippr:${scope}]`;
  return {
    debug: (message, data) => console.debug(prefix, message, data ?? ''),
    info: (message, data) => console.info(prefix, message, data ?? ''),
    warn: (message, data) => console.warn(prefix, message, data ?? ''),
    error: (message, data) => console.error(prefix, message, data ?? '')
  };
}
