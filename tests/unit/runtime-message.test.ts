import { sendRuntimeMessageWithCallback } from '../../src/core/runtime-message';

afterEach(() => vi.unstubAllGlobals());

test('uses the callback runtime messaging form for Firefox MV2 compatibility', async () => {
  const sendMessage = vi.fn((message: unknown, callback: (response: unknown) => void) => {
    expect(message).toEqual({ type: 'PING' });
    callback({ ok: true });
  });
  vi.stubGlobal('chrome', { runtime: { lastError: undefined, sendMessage } });

  await expect(sendRuntimeMessageWithCallback<{ ok: boolean }>({ type: 'PING' })).resolves.toEqual({ ok: true });
  expect(sendMessage).toHaveBeenCalledWith({ type: 'PING' }, expect.any(Function));
});

test('rejects callback messaging errors after consuming runtime.lastError', async () => {
  const runtime = {
    lastError: undefined as { message: string } | undefined,
    sendMessage: vi.fn((_message: unknown, callback: (response?: unknown) => void) => {
      runtime.lastError = { message: 'No receiver.' };
      callback();
      runtime.lastError = undefined;
    })
  };
  vi.stubGlobal('chrome', { runtime });

  await expect(sendRuntimeMessageWithCallback({ type: 'PING' })).rejects.toThrow('No receiver.');
});
