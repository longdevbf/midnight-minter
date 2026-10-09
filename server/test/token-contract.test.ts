import { describe, expect, it } from 'vitest';
import { privateStatePasswordFor } from '../src/chain/token-contract';
import type { OpenWallet } from '../src/chain/wallet-runtime';

// Hàm chỉ đọc keys.unshieldedAddress nên chỉ cần giả lập đúng trường đó.
const walletAt = (unshieldedAddress: string) => ({ keys: { unshieldedAddress } }) as unknown as OpenWallet;

describe('privateStatePasswordFor', () => {
  const a = 'mn_addr_preprod1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq1';
  const b = 'mn_addr_preprod1zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz2';

  it('đủ dài và có chữ hoa, chữ thường, chữ số, ký hiệu', () => {
    const p = privateStatePasswordFor(walletAt(a));
    expect(p.length).toBeGreaterThanOrEqual(16);
    expect(p).toMatch(/[A-Z]/);
    expect(p).toMatch(/[a-z]/);
    expect(p).toMatch(/[0-9]/);
    expect(p).toMatch(/[^A-Za-z0-9]/);
  });

  it('xác định với cùng địa chỉ, khác nhau với địa chỉ khác', () => {
    expect(privateStatePasswordFor(walletAt(a))).toBe(privateStatePasswordFor(walletAt(a)));
    expect(privateStatePasswordFor(walletAt(a))).not.toBe(privateStatePasswordFor(walletAt(b)));
  });
});
