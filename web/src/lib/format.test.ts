import { describe, expect, it } from 'vitest';
import { formatCompactUnits } from './format';

const DUST = 15;

describe('formatCompactUnits', () => {
  it('không cắt phần nguyên: 1234567.89 vẫn đọc đúng, bỏ số 0 thừa', () => {
    expect(formatCompactUnits('1234567890000000000000', DUST, 4)).toBe('1,234,567.89');
  });
  it('số nguyên chẵn không có dấu thập phân thừa', () => {
    expect(formatCompactUnits('5000000000000000', DUST, 4)).toBe('5');
    expect(formatCompactUnits('1000000000000000', DUST, 4)).toBe('1');
  });
  it('số 0 hiển thị 0', () => {
    expect(formatCompactUnits('0', DUST, 4)).toBe('0');
    expect(formatCompactUnits(0n, DUST, 4)).toBe('0');
  });
  it('cắt phần thập phân dài và đánh dấu ≈ vì đã làm tròn xuống', () => {
    expect(formatCompactUnits('1234567890123456789', DUST, 4)).toBe('≈1,234.5678');
  });
  it('bỏ số 0 cuối sau khi cắt, không để lại dấu chấm treo', () => {
    // 1.50001 với tối đa 4 chữ số: cắt còn 1.5000 -> 1.5
    expect(formatCompactUnits('1500010000000000', DUST, 4)).toBe('≈1.5');
    // 2.00001 -> cắt còn 2.0000 -> 2 (không phải "2.")
    expect(formatCompactUnits('2000010000000000', DUST, 4)).toBe('≈2');
  });
  it('số dương rất nhỏ không bao giờ hiện như 0', () => {
    // 123 đơn vị nhỏ nhất = 0.000000000000123 DUST
    expect(formatCompactUnits('123', DUST, 6)).toBe('<0.000001');
    expect(formatCompactUnits('1', DUST, 4)).toBe('<0.0001');
  });
  it('đúng bằng ngưỡng nhỏ nhất thì hiện chính xác, không có tiền tố', () => {
    expect(formatCompactUnits('1000000000', DUST, 6)).toBe('0.000001');
  });
  it('phần nguyên rất lớn vẫn nguyên vẹn (BigInt, không mất độ chính xác)', () => {
    expect(formatCompactUnits('123456789012345678901234567890000000', 6, 2)).toBe('123,456,789,012,345,678,901,234,567,890');
    expect(formatCompactUnits('123456789012345678901234567890123456', 6, 2)).toBe('≈123,456,789,012,345,678,901,234,567,890.12');
  });
  it('decimals nhỏ hơn maxFrac thì không cắt gì', () => {
    expect(formatCompactUnits('1234567', 6, 8)).toBe('1.234567');
    expect(formatCompactUnits('42', 0, 4)).toBe('42');
  });
  it('số âm cũng không bị hiện thành 0', () => {
    expect(formatCompactUnits('-1500000', 6, 2)).toBe('-1.5');
    expect(formatCompactUnits('-1', 6, 2)).toBe('>-0.01');
  });
});
