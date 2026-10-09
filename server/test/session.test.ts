import { afterEach, describe, expect, it, vi } from 'vitest';
import { openStore } from '../src/db/store';
import type { Engine } from '../src/engine/engine';
import { createSession } from '../src/session';

const PASSWORD = 'mat-khau-chu-123';

function stubEngine(closeAll: () => Promise<void>) {
  const stub = { resume: vi.fn(), pollWaiting: vi.fn(), closeAll: vi.fn(closeAll) };
  return stub as unknown as Engine & typeof stub;
}

describe('session.close', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('dừng timer poll và đóng engine', async () => {
    const store = openStore(':memory:');
    const engine = stubEngine(async () => undefined);
    const session = createSession(store, () => engine);
    const clear = vi.spyOn(globalThis, 'clearInterval');
    session.unlock(PASSWORD);
    await session.close();
    expect(clear).toHaveBeenCalledTimes(1);
    expect(engine.closeAll).toHaveBeenCalledTimes(1);
    store.close();
  });

  it('timer poll không còn chạy sau khi close', async () => {
    vi.useFakeTimers();
    const store = openStore(':memory:');
    const engine = stubEngine(async () => undefined);
    const session = createSession(store, () => engine);
    session.unlock(PASSWORD);
    vi.advanceTimersByTime(60_000);
    expect(engine.pollWaiting).toHaveBeenCalledTimes(1);
    await session.close();
    vi.advanceTimersByTime(5 * 60_000);
    expect(engine.pollWaiting).toHaveBeenCalledTimes(1);
    store.close();
  });

  it('close() không treo khi engine.closeAll không bao giờ xong', async () => {
    vi.useFakeTimers();
    const store = openStore(':memory:');
    const engine = stubEngine(() => new Promise<void>(() => undefined));
    const session = createSession(store, () => engine, { shutdownDeadlineMs: 30_000 });
    session.unlock(PASSWORD);
    let done = false;
    const closing = session.close().then(() => { done = true; });
    await vi.advanceTimersByTimeAsync(29_999);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await closing;
    expect(done).toBe(true);
    expect(vi.getTimerCount()).toBe(0); // timer deadline và timer poll đều đã dọn
    store.close();
  });

  it('close() trước khi mở khóa là no-op', async () => {
    const store = openStore(':memory:');
    const session = createSession(store, () => { throw new Error('không được gọi'); });
    await expect(session.close()).resolves.toBeUndefined();
    store.close();
  });

  it('close() xong ngay khi engine đóng xong, không đợi hết deadline', async () => {
    vi.useFakeTimers();
    const store = openStore(':memory:');
    const engine = stubEngine(async () => undefined);
    const session = createSession(store, () => engine, { shutdownDeadlineMs: 30_000 });
    session.unlock(PASSWORD);
    await session.close();
    expect(vi.getTimerCount()).toBe(0);
    store.close();
  });
});

