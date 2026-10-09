import { describe, expect, it } from 'vitest';
import { createVault, makeSalt } from '../src/lib/vault';

describe('vault', () => {
  const salt = makeSalt();

  it('mã hóa rồi giải mã trả về đúng nội dung, kể cả tiếng Việt', () => {
    const v = createVault('mat-khau-chu-123', salt);
    const text = 'Ví số 1 — mật mã bí mật ✓';
    expect(v.decrypt(v.encrypt(text))).toBe(text);
  });

  it('mỗi lần mã hóa cho kết quả khác nhau (IV ngẫu nhiên)', () => {
    const v = createVault('mat-khau-chu-123', salt);
    expect(v.encrypt('abc')).not.toBe(v.encrypt('abc'));
  });

  it('sai mật khẩu thì giải mã thất bại với thông báo rõ', () => {
    const blob = createVault('mat-khau-chu-123', salt).encrypt('seed');
    const wrong = createVault('mat-khau-khac-456', salt);
    expect(() => wrong.decrypt(blob)).toThrow(/Sai mật khẩu chủ/);
  });

  it('dữ liệu bị sửa thì giải mã thất bại', () => {
    const v = createVault('mat-khau-chu-123', salt);
    const parts = v.encrypt('seed').split(':');
    parts[3] = Buffer.from('xxxxxxxx').toString('base64');
    expect(() => v.decrypt(parts.join(':'))).toThrow(/Sai mật khẩu chủ/);
  });

  it('chuỗi sai định dạng bị từ chối', () => {
    const v = createVault('mat-khau-chu-123', salt);
    expect(() => v.decrypt('rac')).toThrow(/không hợp lệ/);
  });

  it('mật khẩu quá ngắn bị từ chối', () => {
    expect(() => createVault('ngan', salt)).toThrow(/ít nhất 8 ký tự/);
  });

  it('cùng mật khẩu và salt giải mã được dữ liệu của phiên trước', () => {
    const blob = createVault('mat-khau-chu-123', salt).encrypt('seed');
    expect(createVault('mat-khau-chu-123', salt).decrypt(blob)).toBe('seed');
  });

  it('mã hóa chuỗi trống rồi giải mã trả về chuỗi trống', () => {
    const v = createVault('mat-khau-chu-123', salt);
    expect(v.decrypt(v.encrypt(''))).toBe('');
  });

  it('tag bị cắt ngắn (8 bytes thay vì 16) bị từ chối', () => {
    const v = createVault('mat-khau-chu-123', salt);
    const parts = v.encrypt('seed').split(':');
    parts[2] = Buffer.from('xxxx').toString('base64'); // 4 bytes → 8 bytes base64
    expect(() => v.decrypt(parts.join(':'))).toThrow(/không hợp lệ/);
  });

  it('IV sai độ dài bị từ chối', () => {
    const v = createVault('mat-khau-chu-123', salt);
    const parts = v.encrypt('seed').split(':');
    parts[1] = Buffer.from('xx').toString('base64'); // 2 bytes thay vì 12
    expect(() => v.decrypt(parts.join(':'))).toThrow(/không hợp lệ/);
  });

  it('tag bị đảo bit (độ dài đúng nhưng sai nội dung) → sai mật khẩu', () => {
    const v = createVault('mat-khau-chu-123', salt);
    const parts = v.encrypt('seed').split(':');
    const tagBuf = Buffer.from(parts[2], 'base64');
    tagBuf[0] ^= 0xff; // flip all bits in first byte
    parts[2] = tagBuf.toString('base64');
    expect(() => v.decrypt(parts.join(':'))).toThrow(/Sai mật khẩu chủ/);
  });

  it('ciphertext bị đảo bit → sai mật khẩu', () => {
    const v = createVault('mat-khau-chu-123', salt);
    const parts = v.encrypt('seed').split(':');
    const encBuf = Buffer.from(parts[3], 'base64');
    if (encBuf.length > 0) encBuf[0] ^= 0xff;
    parts[3] = encBuf.toString('base64');
    expect(() => v.decrypt(parts.join(':'))).toThrow(/Sai mật khẩu chủ/);
  });

  it('blob với 5 segments (quá nhiều) bị từ chối', () => {
    const v = createVault('mat-khau-chu-123', salt);
    expect(() => v.decrypt('v1:a:b:c:d')).toThrow(/không hợp lệ/);
  });

  it('mật khẩu NFC mã hóa được, mật khẩu NFD cùng nội dung giải mã được', () => {
    // Ví dụ: chữ "é" có thể là NFC (U+00E9) hoặc NFD (U+0065 + U+0301)
    const nfc = 'mat-khau-é-nfc'.normalize('NFC');
    const nfd = 'mat-khau-é-nfc'.normalize('NFD');
    const blob = createVault(nfc, salt).encrypt('seed');
    expect(createVault(nfd, salt).decrypt(blob)).toBe('seed');
  });
});
