import { describe, expect, it, vi } from 'vitest';

import type { ReconnectLoopInstance } from '../src/xray/supervisor';
import { runReconnectLoop } from '../src/xray/supervisor';

function makeInstance(
  pid: number,
  exit: { code: number | null; signal: NodeJS.Signals | null } = { code: 1, signal: null },
): ReconnectLoopInstance & { stopMock: ReturnType<typeof vi.fn> } {
  const stopMock = vi.fn(() => Promise.resolve(undefined));

  return {
    pid,
    stop: stopMock,
    waitForExit: () => Promise.resolve(exit),
    stopMock,
  };
}

describe('runReconnectLoop', () => {
  it('retries with backoff and fails after max restarts', async () => {
    const sleepFn = vi.fn(() => Promise.resolve(undefined));
    const onRunning = vi.fn(() => Promise.resolve(undefined));
    const onExit = vi.fn(() => Promise.resolve(undefined));
    const onFailure = vi.fn(() => Promise.resolve(undefined));

    let pid = 1000;
    const startInstance = vi.fn(() => Promise.resolve(makeInstance(pid++)));

    await runReconnectLoop({
      maxRestarts: 3,
      backoffMs: [1000, 2000, 4000],
      shouldStop: () => false,
      startInstance,
      healthCheck: () => Promise.resolve(true),
      onRunning,
      onExit,
      onFailure,
      sleepFn,
      startupFailureReason: 'STARTUP_FAILED: test',
    });

    expect(startInstance).toHaveBeenCalledTimes(4);
    expect(onRunning).toHaveBeenCalledTimes(4);
    expect(onExit).toHaveBeenCalledTimes(4);
    expect(onFailure).toHaveBeenCalledTimes(1);
    expect(sleepFn.mock.calls.map((call) => call[0])).toEqual([1000, 2000, 4000]);
  });

  it('marks startup as failed when health-check never passes', async () => {
    const sleepFn = vi.fn(() => Promise.resolve(undefined));
    const onRunning = vi.fn(() => Promise.resolve(undefined));
    const onExit = vi.fn(() => Promise.resolve(undefined));
    const onFailure = vi.fn(() => Promise.resolve(undefined));

    const first = makeInstance(2001);
    const second = makeInstance(2002);
    const startInstance = vi
      .fn<() => Promise<ReconnectLoopInstance>>()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);

    await runReconnectLoop({
      maxRestarts: 1,
      backoffMs: [1000],
      shouldStop: () => false,
      startInstance,
      healthCheck: () => Promise.resolve(false),
      onRunning,
      onExit,
      onFailure,
      sleepFn,
      startupFailureReason: 'STARTUP_FAILED: test',
    });

    expect(first.stopMock).toHaveBeenCalledTimes(1);
    expect(second.stopMock).toHaveBeenCalledTimes(1);
    expect(onRunning).not.toHaveBeenCalled();
    expect(onFailure).toHaveBeenCalledTimes(1);
    expect(onFailure.mock.calls[0]?.[0]).toContain('STARTUP_FAILED');
    expect(sleepFn.mock.calls.map((call) => call[0])).toEqual([1000]);
  });
});
