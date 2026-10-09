import { describe, expect, it } from 'vitest';
import {
  MAX_U64,
  ValidationError,
  applyTemplate,
  toBaseUnits,
  validateImage,
  validateTokenMeta,
} from '../src/lib/metadata';

const ok = { name: 'Papa Coin', symbol: 'papa', decimals: 6, amount: '1000000' };

describe('validateTokenMeta', () => {
  it('chấp nhận dữ liệu hợp lệ, trim và viết hoa symbol', () => {
    expect(validateTokenMeta({ ...ok, name: '  Papa Coin  ' })).toEqual({
      name: 'Papa Coin', symbol: 'PAPA', decimals: 6, amount: '1000000',
    });
  });

  it('báo lỗi theo từng field khi thiếu', () => {
    try {
      validateTokenMeta({});
      throw new Error('phải ném lỗi');
    } catch (e) {
      expect(e).toBeInstanceOf(ValidationError);
      const f = (e as ValidationError).fields;
      expect(Object.keys(f).sort()).toEqual(['amount', 'decimals', 'name', 'symbol']);
    }
  });

  it('từ chối name rỗng, quá 64 ký tự, hoặc quá 200 byte', () => {
    expect(() => validateTokenMeta({ ...ok, name: '   ' })).toThrow(ValidationError);
    expect(() => validateTokenMeta({ ...ok, name: 'a'.repeat(65) })).toThrow(ValidationError);
    // Biên 64 đơn vị UTF-16: 64 ký tự BMP hợp lệ; 𝔄 là cặp surrogate (2 đơn vị, 4 byte) nên 32 cái hợp lệ, 33 cái thì không.
    expect(() => validateTokenMeta({ ...ok, name: 'a'.repeat(64) })).not.toThrow();
    expect(() => validateTokenMeta({ ...ok, name: '𝔄'.repeat(32) })).not.toThrow();
    expect(() => validateTokenMeta({ ...ok, name: '𝔄'.repeat(33) })).toThrow(ValidationError);
    // 'ệ' ×64 = 192 byte (≤ 200) vẫn hợp lệ. Quy tắc 200 byte không thể kích hoạt trong 64 đơn vị UTF-16 (tối đa 3 byte/đơn vị = 192).
    expect(() => validateTokenMeta({ ...ok, name: 'ệ'.repeat(64) })).not.toThrow();
    expect(() => validateTokenMeta({ ...ok, name: 'ệ'.repeat(65) })).toThrow(ValidationError);
  });

  it('từ chối symbol sai quy tắc', () => {
    for (const symbol of ['', 'a b', 'TOOLONGSYMBOL1', 'ĐÔ', 'a-b']) {
      expect(() => validateTokenMeta({ ...ok, symbol })).toThrow(ValidationError);
    }
  });

  it('từ chối symbol có ký tự ngoài ASCII mà toUpperCase sẽ biến thành ASCII', () => {
    for (const symbol of ['ß', 'ſ', 'ı', 'ﬁ', 'ßß']) {
      expect(() => validateTokenMeta({ ...ok, symbol })).toThrow(ValidationError);
    }
  });

  it('từ chối decimals ngoài 0–18 hoặc không nguyên', () => {
    for (const decimals of [-1, 19, 1.5, '6', null]) {
      expect(() => validateTokenMeta({ ...ok, decimals })).toThrow(ValidationError);
    }
  });

  it('từ chối số lượng 0, âm, thập phân, có chữ, bắt đầu bằng 0', () => {
    for (const amount of ['0', '-5', '1.5', '1e6', 'abc', '007', '', ' ']) {
      expect(() => validateTokenMeta({ ...ok, amount })).toThrow(ValidationError);
    }
  });

  it('từ chối số lượng khi nhân 10^decimals vượt Uint64', () => {
    expect(() => validateTokenMeta({ ...ok, decimals: 18, amount: '19' })).toThrow(/Uint64|giới hạn/);
    expect(() => validateTokenMeta({ ...ok, decimals: 18, amount: '18' })).not.toThrow();
  });
});

describe('toBaseUnits', () => {
  it('nhân với 10^decimals', () => {
    expect(toBaseUnits('1000000', 6)).toBe(1_000_000_000_000n);
    expect(toBaseUnits('5', 0)).toBe(5n);
  });
  it('chấp nhận đúng giá trị lớn nhất của Uint64 và từ chối lớn hơn', () => {
    expect(toBaseUnits(MAX_U64.toString(), 0)).toBe(MAX_U64);
    expect(() => toBaseUnits((MAX_U64 + 1n).toString(), 0)).toThrow(ValidationError);
  });
});

describe('applyTemplate', () => {
  it('thay mọi {n}', () => {
    expect(applyTemplate('Papa Coin #{n}', 3)).toBe('Papa Coin #3');
    expect(applyTemplate('P{n}-{n}', 12)).toBe('P12-12');
  });
  it('không có {n} thì giữ nguyên', () => {
    expect(applyTemplate('Papa', 3)).toBe('Papa');
  });
});

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([1, 0, 0, 0]), Buffer.from('WEBPVP8 ')]);

describe('validateImage', () => {
  it('nhận PNG/JPEG/WEBP đúng nội dung và tính sha256', () => {
    const r = validateImage(PNG, 'image/png');
    expect(r.ext).toBe('png');
    expect(r.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(validateImage(JPG, 'image/jpeg').ext).toBe('jpg');
    expect(validateImage(WEBP, 'image/webp').ext).toBe('webp');
  });
  it('từ chối ảnh giả: mime là PNG nhưng nội dung không phải', () => {
    expect(() => validateImage(Buffer.from('<html>hi</html>'), 'image/png')).toThrow(ValidationError);
    expect(() => validateImage(JPG, 'image/png')).toThrow(ValidationError);
  });
  it('mime trùng tên thuộc tính của Object thì ném ValidationError, không phải TypeError', () => {
    for (const mime of ['constructor', 'toString', 'hasOwnProperty', '__proto__', 'valueOf']) {
      expect(() => validateImage(PNG, mime)).toThrow(ValidationError);
    }
  });
  it('từ chối loại không hỗ trợ, ảnh rỗng, ảnh quá 5 MB', () => {
    expect(() => validateImage(PNG, 'image/svg+xml')).toThrow(ValidationError);
    expect(() => validateImage(Buffer.alloc(0), 'image/png')).toThrow(ValidationError);
    const big = Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024)]);
    expect(() => validateImage(big, 'image/png')).toThrow(/5 MB/);
  });
});
