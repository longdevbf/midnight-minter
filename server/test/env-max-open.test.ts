import { describe, expect, it } from 'vitest';
import { loadEnv } from '../src/config/env';

describe('loadEnv: MAX_OPEN_WALLETS (R2)', () => {
  const base = { PINATA_JWT: 'x'.repeat(30) };

  it('mặc định 6 (kể cả khi để trống)', () => {
    expect(loadEnv(base).maxOpenWallets).toBe(6);
    expect(loadEnv({ ...base, MAX_OPEN_WALLETS: '' }).maxOpenWallets).toBe(6);
  });

  it('đọc số nguyên trong khoảng 1–20', () => {
    expect(loadEnv({ ...base, MAX_OPEN_WALLETS: '1' }).maxOpenWallets).toBe(1);
    expect(loadEnv({ ...base, MAX_OPEN_WALLETS: '10' }).maxOpenWallets).toBe(10);
    expect(loadEnv({ ...base, MAX_OPEN_WALLETS: '20' }).maxOpenWallets).toBe(20);
  });

  it('từ chối giá trị ngoài khoảng hoặc không phải số nguyên', () => {
    for (const v of ['0', '21', '2.5', 'abc', '-3']) {
      expect(() => loadEnv({ ...base, MAX_OPEN_WALLETS: v })).toThrow(/MAX_OPEN_WALLETS/);
    }
  });
});
