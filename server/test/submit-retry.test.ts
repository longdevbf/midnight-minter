import { describe, expect, it, vi } from 'vitest';
import { isTransientSubmitError, submitWithRetry } from '../src/chain/submit-retry';

const wsClosed = () =>
  Object.assign(new Error('Transaction submission error'), {
    cause: Object.assign(new Error('Transaction submission failed'), {
      cause: new Error('disconnected from wss://rpc.preview.midnight.network/: 1000:: Normal Closure'),
    }),
  });

describe('submitWithRetry', () => {
  it('nhận ra lỗi đóng WebSocket nằm sâu trong chuỗi nguyên nhân', () => {
    expect(isTransientSubmitError(wsClosed())).toBe(true);
    expect(isTransientSubmitError(new Error('1010: Invalid Transaction'))).toBe(false);
  });

  it('thử lại lỗi mạng rồi thành công', async () => {
    const fn = vi.fn().mockRejectedValueOnce(wsClosed()).mockRejectedValueOnce(wsClosed()).mockResolvedValue('tx');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(submitWithRetry(fn, { delayMs: 1 })).resolves.toBe('tx');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('không thử lại khi node từ chối giao dịch', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('1010: Invalid Transaction'));
    await expect(submitWithRetry(fn, { delayMs: 1 })).rejects.toThrow('1010');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('bỏ cuộc sau số lần tối đa', async () => {
    const fn = vi.fn().mockRejectedValue(wsClosed());
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(submitWithRetry(fn, { attempts: 3, delayMs: 1 })).rejects.toThrow('Transaction submission error');
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
