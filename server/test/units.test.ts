import { describe, expect, it } from 'vitest';
import { DUST_DECIMALS, NIGHT_DECIMALS, formatUnits, shortAddr } from '../../shared/units';

describe('formatUnits', () => {
  it('định dạng số nguyên có dấu phân cách nghìn', () => {
    expect(formatUnits('1000000000', NIGHT_DECIMALS)).toBe('1,000');
  });
  it('giữ phần thập phân và bỏ số 0 thừa', () => {
    expect(formatUnits('1500000', NIGHT_DECIMALS)).toBe('1.5');
    expect(formatUnits(123456789n, 6)).toBe('123.456789');
  });
  it('xử lý 0 và decimals = 0', () => {
    expect(formatUnits('0', 6)).toBe('0');
    expect(formatUnits('1234567', 0)).toBe('1,234,567');
  });
  it('DUST có 15 chữ số thập phân', () => {
    expect(formatUnits('300000000000000', DUST_DECIMALS)).toBe('0.3');
  });
  it('giá trị rất nhỏ không bị làm tròn về 0', () => {
    expect(formatUnits('1', DUST_DECIMALS)).toBe('0.000000000000001');
  });
});

describe('shortAddr', () => {
  it('rút gọn địa chỉ dài', () => {
    expect(shortAddr('mn_addr_preprod1abcdefghijklmnopqrstuvwxyz', 10, 4)).toBe('mn_addr_pr…wxyz');
  });
  it('giữ nguyên địa chỉ ngắn', () => {
    expect(shortAddr('abc', 10, 4)).toBe('abc');
  });
});
