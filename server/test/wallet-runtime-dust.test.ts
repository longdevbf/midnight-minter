import { describe, expect, it } from 'vitest';
import * as Rx from 'rxjs';
import { ensureDust, type OpenWallet } from '../src/chain/wallet-runtime';

/** OpenWallet giả tối thiểu cho ensureDust: một UTXO chưa đăng ký, waitForGeneratedDust do test quyết định. */
function fakeWallet(waitForGeneratedDust: () => Promise<void>): OpenWallet {
  const facade = {
    waitForSyncedState: async () => ({
      unshielded: { availableCoins: [{ meta: { registeredForDustGeneration: false } }] },
    }),
    estimateRegistration: async () => ({ fee: 1n }),
    waitForGeneratedDust,
  };
  return { facade, keys: {}, network: {}, close: async () => undefined } as unknown as OpenWallet;
}

/** TimeoutError của bản rxjs khác (SDK đóng gói rxjs riêng): instanceof không khớp, chỉ còn name. */
class ForeignTimeoutError extends Error {
  constructor() {
    super('Timeout has occurred');
    this.name = 'TimeoutError';
  }
}

describe('ensureDust: lỗi quá thời gian chờ DUST sinh ra bằng tiếng Việt (F3)', () => {
  it('Rx.TimeoutError từ waitForGeneratedDust → thông báo tiếng Việt', async () => {
    const w = fakeWallet(async () => {
      throw new Rx.TimeoutError();
    });
    await expect(ensureDust(w)).rejects.toThrow('Chờ DUST sinh ra quá lâu. Bấm Thử lại.');
  });

  it('TimeoutError của bản rxjs khác (theo name) → thông báo tiếng Việt', async () => {
    const w = fakeWallet(async () => {
      throw new ForeignTimeoutError();
    });
    await expect(ensureDust(w)).rejects.toThrow('Chờ DUST sinh ra quá lâu. Bấm Thử lại.');
  });

  it('lỗi khác giữ nguyên', async () => {
    const boom = new Error('indexer chết');
    const w = fakeWallet(async () => {
      throw boom;
    });
    await expect(ensureDust(w)).rejects.toBe(boom);
  });
});
