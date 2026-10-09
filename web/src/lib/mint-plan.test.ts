import { describe, expect, it } from 'vitest';
import { MAX_IMAGE_BYTES, planNames, validateImageFile, validateRows, validateTemplate } from './mint-plan';

const tpl = { name: 'Papa Coin #{n}', symbol: 'PAPA{n}', decimals: 6, amount: '1000' };

describe('planNames', () => {
  it('sinh name/symbol theo thứ tự ví', () => {
    expect(planNames(tpl, ['a', 'b', 'c'])).toEqual([
      { walletId: 'a', name: 'Papa Coin #1', symbol: 'PAPA1' },
      { walletId: 'b', name: 'Papa Coin #2', symbol: 'PAPA2' },
      { walletId: 'c', name: 'Papa Coin #3', symbol: 'PAPA3' },
    ]);
  });
  it('viết hoa symbol', () => {
    expect(planNames({ ...tpl, symbol: 'papa{n}' }, ['a'])[0].symbol).toBe('PAPA1');
  });
  it('không viết hoa symbol sai định dạng (ß không bị đổi thành SS)', () => {
    expect(planNames({ ...tpl, symbol: 'ß{n}' }, ['a'])[0].symbol).toBe('ß1');
  });
  it('override được dùng nguyên văn, không thay {n}', () => {
    const rows = planNames(tpl, ['a', 'b'], { b: { name: 'Riêng {n}', symbol: 'x{n}' } });
    expect(rows[1]).toEqual({ walletId: 'b', name: 'Riêng {n}', symbol: 'x{n}' });
  });
  it('override hợp lệ được viết hoa như server', () => {
    expect(planNames(tpl, ['a'], { a: { symbol: ' abc ' } })[0].symbol).toBe('ABC');
  });
  it('override rỗng vẫn là override (server dùng nguyên văn)', () => {
    const rows = planNames(tpl, ['a'], { a: { name: '' } });
    expect(rows[0].name).toBe('');
  });
});

describe('validateTemplate', () => {
  it('mẫu hợp lệ không có lỗi', () => {
    expect(validateTemplate(tpl, 3, true)).toEqual({});
  });
  it('báo lỗi từng field', () => {
    const e = validateTemplate({ name: '', symbol: 'a b', decimals: 19, amount: '0' }, 1, false);
    expect(Object.keys(e).sort()).toEqual(['amount', 'decimals', 'image', 'name', 'symbol']);
  });
  it('nhiều ví mà symbol không có {n}', () => {
    const e = validateTemplate({ ...tpl, symbol: 'PAPA' }, 2, true);
    expect(e.symbol).toMatch(/\{n\}/);
  });
  it('một ví thì symbol không cần {n}', () => {
    expect(validateTemplate({ ...tpl, symbol: 'PAPA' }, 1, true)).toEqual({});
  });
  it('số lượng nhân decimals vượt Uint64', () => {
    const e = validateTemplate({ ...tpl, decimals: 18, amount: '19' }, 1, true);
    expect(e.amount).toMatch(/Uint64/);
  });
  it('đúng bằng giới hạn Uint64 thì hợp lệ', () => {
    expect(validateTemplate({ ...tpl, decimals: 0, amount: '18446744073709551615' }, 1, true)).toEqual({});
    expect(validateTemplate({ ...tpl, decimals: 0, amount: '18446744073709551616' }, 1, true).amount).toMatch(/Uint64/);
  });
  it('chưa chọn ví', () => {
    expect(validateTemplate(tpl, 0, true).wallets).toMatch(/ví/);
  });
  it('quá 50 ví', () => {
    expect(validateTemplate(tpl, 51, true).wallets).toMatch(/50/);
  });
  it('symbol sinh ra vượt 12 ký tự', () => {
    const e = validateTemplate({ ...tpl, symbol: 'ABCDEFGHIJKL{n}' }, 1, true);
    expect(e.symbol).toMatch(/12/);
  });
  it('symbol vượt 12 chỉ khi số thứ tự dài ra (10 ví)', () => {
    const t = { ...tpl, symbol: 'ABCDEFGHI{n}' };
    expect(validateTemplate(t, 9, true).symbol).toBeUndefined(); // 10 ký tự
    expect(validateTemplate({ ...tpl, symbol: 'ABCDEFGHIJ{n}' }, 10, true).symbol).toBeUndefined(); // 'ABCDEFGHIJ10' = 12
    expect(validateTemplate({ ...tpl, symbol: 'ABCDEFGHIJK{n}' }, 10, true).symbol).toMatch(/12/);
    expect(validateTemplate({ ...tpl, symbol: 'ABCDEFGHIJK{n}' }, 9, true).symbol).toBeUndefined(); // 12 ký tự
  });
  it("'ß' bị từ chối (kiểm tra trước khi viết hoa, không thành 'SS')", () => {
    expect(validateTemplate({ ...tpl, symbol: 'ß{n}' }, 1, true).symbol).toBeTruthy();
    expect(validateTemplate({ ...tpl, symbol: 'Straße' }, 1, true).symbol).toBeTruthy();
  });
  it('symbol có khoảng trắng hai đầu được cắt như server', () => {
    expect(validateTemplate({ ...tpl, symbol: '  PAPA{n} ' }, 1, true)).toEqual({});
  });
  it('tên tối đa 64 đơn vị UTF-16 sau khi thay {n}', () => {
    expect(validateTemplate({ ...tpl, name: 'x'.repeat(64) }, 1, true).name).toBeUndefined();
    expect(validateTemplate({ ...tpl, name: 'x'.repeat(65) }, 1, true).name).toMatch(/64/);
    expect(validateTemplate({ ...tpl, name: 'x'.repeat(63) + '{n}' }, 10, true).name).toMatch(/64/);
    // emoji = 2 đơn vị UTF-16
    expect(validateTemplate({ ...tpl, name: '😀'.repeat(33) }, 1, true).name).toMatch(/64/);
  });
  it('tên toàn khoảng trắng bị từ chối', () => {
    expect(validateTemplate({ ...tpl, name: '   ' }, 1, true).name).toBeTruthy();
  });
  it('decimals không phải số nguyên', () => {
    expect(validateTemplate({ ...tpl, decimals: 1.5 }, 1, true).decimals).toBeTruthy();
    expect(validateTemplate({ ...tpl, decimals: Number.NaN }, 1, true).decimals).toBeTruthy();
  });
  it('số lượng sai định dạng', () => {
    for (const amount of ['', '01', '1,000', '-5', '1.5', 'abc']) {
      expect(validateTemplate({ ...tpl, amount }, 1, true).amount, amount).toBeTruthy();
    }
  });
});

describe('validateRows (kiểm tra từng dòng sau khi áp override)', () => {
  it('dòng hợp lệ không có lỗi', () => {
    expect(validateRows(planNames(tpl, ['a', 'b']))).toEqual({});
  });
  it('override symbol sai định dạng bị báo ở đúng dòng', () => {
    const rows = planNames(tpl, ['a', 'b'], { b: { symbol: 'a b' } });
    const e = validateRows(rows);
    expect(e.a).toBeUndefined();
    expect(e.b?.symbol).toMatch(/Symbol/);
  });
  it("override 'ß' bị từ chối", () => {
    const e = validateRows(planNames(tpl, ['a'], { a: { symbol: 'ß' } }));
    expect(e.a?.symbol).toBeTruthy();
  });
  it('override symbol dài hơn 12 bị từ chối', () => {
    const e = validateRows(planNames(tpl, ['a'], { a: { symbol: 'ABCDEFGHIJKLM' } }));
    expect(e.a?.symbol).toBeTruthy();
  });
  it('override tên rỗng hoặc quá 64 bị từ chối', () => {
    const e = validateRows(planNames(tpl, ['a', 'b'], { a: { name: '  ' }, b: { name: 'y'.repeat(65) } }));
    expect(e.a?.name).toBeTruthy();
    expect(e.b?.name).toMatch(/64/);
  });
  it('override có {n} được dùng nguyên văn nên symbol bị từ chối', () => {
    const e = validateRows(planNames(tpl, ['a'], { a: { symbol: 'X{n}' } }));
    expect(e.a?.symbol).toBeTruthy();
  });
  it('symbol trùng trong lô bị từ chối bằng tiếng Việt (không phân biệt hoa thường)', () => {
    const rows = planNames(tpl, ['a', 'b', 'c'], { b: { symbol: 'papa1' } });
    const e = validateRows(rows);
    expect(e.a?.symbol).toMatch(/trùng/);
    expect(e.b?.symbol).toMatch(/trùng/);
    expect(e.c).toBeUndefined();
  });
});

describe('validateImageFile', () => {
  it('chấp nhận PNG/JPEG/WEBP trong giới hạn', () => {
    for (const type of ['image/png', 'image/jpeg', 'image/webp']) {
      expect(validateImageFile({ type, size: 1000 })).toBeNull();
    }
    expect(validateImageFile({ type: 'image/png', size: MAX_IMAGE_BYTES })).toBeNull();
  });
  it('từ chối định dạng khác', () => {
    expect(validateImageFile({ type: 'image/gif', size: 10 })).toBe('Ảnh phải là PNG, JPEG hoặc WEBP');
    expect(validateImageFile({ type: '', size: 10 })).toBe('Ảnh phải là PNG, JPEG hoặc WEBP');
  });
  it('từ chối ảnh quá 5 MB', () => {
    expect(validateImageFile({ type: 'image/png', size: MAX_IMAGE_BYTES + 1 })).toBe('Ảnh quá lớn (tối đa 5 MB)');
  });
  it('từ chối file rỗng', () => {
    expect(validateImageFile({ type: 'image/png', size: 0 })).toBe('File ảnh rỗng');
  });
});
