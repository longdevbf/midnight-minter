import { MidnightBech32m } from '@midnightntwrk/wallet-sdk';
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

  // Vector đã biết: mnemonic kiểm thử BIP-39 công khai (không phải bí mật).
  // Các giá trị dưới đây là điểm ghim hồi quy, tính từ cài đặt hiện tại (seed BIP-39 đủ 64 byte,
  // account 0, index 0, các vai Zswap/NightExternal/Dust). Việc khớp với Lace/1AM cho cùng
  // mnemonic sẽ được kiểm tay ở giai đoạn live.
  describe('vector đã biết (abandon x23 + art)', () => {
    const vector = `${'abandon '.repeat(23)}art`;
    const addrBytesHex = '2d8c83c0c382c91f67fbde88dd1d7c27823192505a8753e7a14a92d5b4e2aa02';

    it('địa chỉ unshielded và byte địa chỉ khớp giá trị ghim', async () => {
      const preprod = await deriveKeys(vector, 'preprod');
      const preview = await deriveKeys(vector, 'preview');
      expect(preprod.unshieldedAddress).toBe('mn_addr_preprod19kxg8sxrsty37elmm6yd68tuy7prryjst2r48eapf2fdtd8z4gpq88xj6h');
      expect(preview.unshieldedAddress).toBe('mn_addr_preview19kxg8sxrsty37elmm6yd68tuy7prryjst2r48eapf2fdtd8z4gpq8xczf2');
      expect(Buffer.from(preprod.unshieldedAddressBytes).toString('hex')).toBe(addrBytesHex);
      expect(Buffer.from(preview.unshieldedAddressBytes).toString('hex')).toBe(addrBytesHex);
    });

    it('byte địa chỉ trùng dữ liệu mã hóa trong địa chỉ bech32 preprod', async () => {
      const k = await deriveKeys(vector, 'preprod');
      const decoded = MidnightBech32m.parse(k.unshieldedAddress).data;
      expect(Buffer.from(k.unshieldedAddressBytes).equals(decoded)).toBe(true);
    });

    it('khóa công khai shielded (coin public key) khớp giá trị ghim', async () => {
      const k = await deriveKeys(vector, 'preprod');
      expect(String(k.shielded.coinPublicKey)).toBe('9408aeffbeedc6b9b45e1bcc621d1a273fb67f77de3f65bfbb1814d84f8b6524');
    });
  });
});
