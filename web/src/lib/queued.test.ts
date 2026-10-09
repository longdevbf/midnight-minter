import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import { QUEUED_FALSE_INFO, queuedInfo } from './queued';

afterEach(() => vi.unstubAllGlobals());

describe('queuedInfo', () => {
  it('queued:false trả thông báo "đang chạy"', () => {
    expect(queuedInfo({ ok: true, queued: false })).toBe(QUEUED_FALSE_INFO);
    expect(QUEUED_FALSE_INFO).toBe('Việc này đang chạy, đợi hoàn tất');
  });
  it('queued:true không có thông báo', () => {
    expect(queuedInfo({ ok: true, queued: true })).toBeNull();
  });
});

describe('api retry/refresh trả { ok, queued }', () => {
  it('chuyển nguyên kết quả của server cho UI', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true, queued: false }), { status: 202 })));
    expect(queuedInfo(await api.retryWallet('w1'))).toBe(QUEUED_FALSE_INFO);
    expect(queuedInfo(await api.refreshWallet('w1'))).toBe(QUEUED_FALSE_INFO);
    expect(queuedInfo(await api.retryToken('t1'))).toBe(QUEUED_FALSE_INFO);
  });
});
