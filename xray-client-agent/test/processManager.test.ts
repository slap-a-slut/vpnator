import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';

import { describe, expect, it, vi } from 'vitest';

import { XrayProcessManager } from '../src/xray/processManager';

class FakeChildProcess extends EventEmitter {
  public unrefCalled = false;

  public constructor(public readonly pid: number) {
    super();
  }

  public unref(): void {
    this.unrefCalled = true;
  }
}

describe('XrayProcessManager', () => {
  it('starts process and returns pid', async () => {
    const child = new FakeChildProcess(1234);

    const spawnFn = vi.fn(() => child as unknown as ChildProcess);
    const manager = new XrayProcessManager({
      spawnFn,
      isRunningFn: () => true,
      sleepFn: () => Promise.resolve(),
      waitForStartMs: 10,
      pollIntervalMs: 1,
    });

    const pid = await manager.start({
      binary: 'xray',
      args: ['run'],
      options: { detached: true },
    });

    expect(pid).toBe(1234);
    expect(spawnFn).toHaveBeenCalledTimes(1);
    expect(child.unrefCalled).toBe(true);
  });

  it('stops running process with SIGTERM', async () => {
    const killFn = vi.fn();
    let checks = 0;

    const manager = new XrayProcessManager({
      killFn: killFn as unknown as typeof process.kill,
      isRunningFn: () => {
        checks += 1;
        return checks < 3;
      },
      sleepFn: () => Promise.resolve(),
      pollIntervalMs: 1,
      stopTimeoutMs: 20,
    });

    await manager.stop(2222);

    expect(killFn).toHaveBeenCalledWith(2222, 'SIGTERM');
  });

  it('throws if process does not become ready', async () => {
    const child = new FakeChildProcess(9999);

    const manager = new XrayProcessManager({
      spawnFn: () => child as unknown as ChildProcess,
      isRunningFn: () => false,
      sleepFn: () => Promise.resolve(),
      waitForStartMs: 2,
      pollIntervalMs: 1,
    });

    await expect(
      manager.start({
        binary: 'xray',
        args: ['run'],
        options: { detached: true },
      }),
    ).rejects.toThrowError('xray-core process did not become ready in time');
  });
});
