import { describe, expect, it } from 'vitest';
import { deriveKeys, newMnemonic } from '../src/chain/keys';

describe('keys', () => {
  it('sinh mnemonic 24 từ hợp lệ, mỗi lần khác nhau', () => {
    const a = newMnemonic();
    expect(a.split(' ')).toHaveLength(24);
    expect(newMnemonic()).not.toBe(a);
  });

  it('cùng mnemonic cho cùng địa chỉ (xác định)', async () => {
    const m = newMnemonic();
    const k1 = await deriveKeys(m, 'preprod');
    const k2 = await deriveKeys(m, 'preprod');
    expect(k1.unshieldedAddress).toBe(k2.unshieldedAddress);
    expect(Buffer.from(k1.unshieldedAddressBytes).equals(Buffer.from(k2.unshieldedAddressBytes))).toBe(true);
  });

  it('địa chỉ mang tiền tố đúng mạng', async () => {
    const m = newMnemonic();
    expect((await deriveKeys(m, 'preprod')).unshieldedAddress).toMatch(/^mn_addr_preprod1/);
    expect((await deriveKeys(m, 'preview')).unshieldedAddress).toMatch(/^mn_addr_preview1/);
  });

  it('địa chỉ dạng byte dài 32', async () => {
    expect((await deriveKeys(newMnemonic(), 'preprod')).unshieldedAddressBytes).toHaveLength(32);
  });

  it('hai mnemonic khác nhau cho hai địa chỉ khác nhau', async () => {
    const a = await deriveKeys(newMnemonic(), 'preprod');
    const b = await deriveKeys(newMnemonic(), 'preprod');
    expect(a.unshieldedAddress).not.toBe(b.unshieldedAddress);
  });

  it('mnemonic sai bị từ chối với thông báo tiếng Việt', async () => {
    await expect(deriveKeys('khong phai mnemonic hop le', 'preprod')).rejects.toThrow(/Seedphrase không hợp lệ/);
  });

  it('chuẩn hóa khoảng trắng thừa trong mnemonic', async () => {
    const m = newMnemonic();
    const a = await deriveKeys(m, 'preprod');
    const b = await deriveKeys(`  ${m.replaceAll(' ', '   ')}  `, 'preprod');
    expect(b.unshieldedAddress).toBe(a.unshieldedAddress);
  });
});
