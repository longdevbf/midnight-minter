import { formatUnits } from '../../../shared/units';

/**
 * Bản rút gọn của formatUnits cho danh sách: không bao giờ cắt phần nguyên, chỉ cắt phần thập phân
 * xuống tối đa `maxFrac` chữ số (cắt xuống, không làm tròn lên).
 * - Cắt mất chữ số thì thêm tiền tố "≈" để không ai tưởng đó là số chính xác.
 * - Số khác 0 nhưng nhỏ hơn 1 đơn vị hiển thị thì hiện "<0.00…1" (hoặc ">-0.00…1" với số âm), không bao giờ là 0.
 * Màn hình chi tiết vẫn dùng formatUnits để thấy đủ giá trị.
 */
export function formatCompactUnits(raw: string | bigint, decimals: number, maxFrac: number): string {
  const value = typeof raw === 'bigint' ? raw : BigInt(raw);
  if (value === 0n) return '0';
  const drop = decimals - maxFrac;
  if (drop <= 0) return formatUnits(value, decimals);

  const step = 10n ** BigInt(drop);
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const truncated = abs - (abs % step); // chỉ bỏ các chữ số thập phân thừa
  if (truncated === 0n) {
    const tiny = maxFrac > 0 ? `0.${'0'.repeat(maxFrac - 1)}1` : '1';
    return negative ? `>-${tiny}` : `<${tiny}`;
  }
  const text = formatUnits(negative ? -truncated : truncated, decimals);
  return truncated === abs ? text : `≈${text}`;
}
