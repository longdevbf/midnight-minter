import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '../api';

afterEach(() => vi.unstubAllGlobals());

describe('api client lỗi', () => {
  it('mất kết nối (fetch ném TypeError) thành ApiError status 0 với thông điệp tiếng Việt', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const err = await api.status().catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(0);
    expect(err.message).toBe('Không kết nối được máy chủ app. Kiểm tra app còn chạy không.');
  });
  it('lỗi không phải JSON và statusText rỗng thì dùng "Lỗi <mã>"', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>', { status: 502, statusText: '' })));
    const err = await api.status().catch((e) => e);
    expect(err.status).toBe(502);
    expect(err.message).toBe('Lỗi 502');
  });
  it('lỗi JSON có trường error thì dùng thông điệp của server', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'Sai mật khẩu chủ' }), { status: 401 })));
    const err = await api.unlock('x').catch((e) => e);
    expect(err.status).toBe(401);
    expect(err.message).toBe('Sai mật khẩu chủ');
  });
  it('401 gọi bộ xử lý đã đăng ký (trừ khi đang mở khóa), lỗi vẫn được ném', async () => {
    const handler = vi.fn();
    api.onUnauthorized(handler);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'x' }), { status: 401 })));
    await expect(api.wallets()).rejects.toBeInstanceOf(ApiError);
    expect(handler).toHaveBeenCalledTimes(1);
    await expect(api.unlock('x')).rejects.toBeInstanceOf(ApiError);
    expect(handler).toHaveBeenCalledTimes(1);
    api.onUnauthorized(null);
  });
});
