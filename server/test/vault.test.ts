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
});
