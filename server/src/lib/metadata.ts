import { createHash } from 'node:crypto';
import { z } from 'zod';

export const MAX_U64 = 18446744073709551615n;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export class ValidationError extends Error {
  constructor(public readonly fields: Record<string, string>) {
    super(Object.values(fields).join('; '));
    this.name = 'ValidationError';
  }
}

export interface TokenMeta {
  name: string;
  symbol: string;
  decimals: number;
  /** số lượng theo đơn vị token (chưa nhân 10^decimals) */
  amount: string;
}

const Schema = z.object({
  name: z
    .string({ required_error: 'Thiếu tên token', invalid_type_error: 'Tên token không hợp lệ' })
    .trim()
    .min(1, 'Tên token không được để trống')
    .max(64, 'Tên token tối đa 64 ký tự')
    .refine((s) => Buffer.byteLength(s, 'utf8') <= 200, 'Tên token quá dài (tối đa 200 byte)'),
  symbol: z
    .string({ required_error: 'Thiếu symbol', invalid_type_error: 'Symbol không hợp lệ' })
    .trim()
    .transform((s) => s.toUpperCase())
    .pipe(z.string().regex(/^[A-Z0-9]{1,12}$/, 'Symbol gồm 1–12 chữ cái/số, không dấu, không khoảng trắng')),
  decimals: z
    .number({ required_error: 'Thiếu decimals', invalid_type_error: 'Decimals phải là số' })
    .int('Decimals phải là số nguyên')
    .min(0, 'Decimals tối thiểu 0')
    .max(18, 'Decimals tối đa 18'),
  amount: z
    .string({ required_error: 'Thiếu số lượng', invalid_type_error: 'Số lượng không hợp lệ' })
    .regex(/^[1-9][0-9]*$/, 'Số lượng phải là số nguyên dương, không có dấu phẩy hay số 0 đứng đầu'),
});

export function validateTokenMeta(input: unknown): TokenMeta {
  const parsed = Schema.safeParse(input ?? {});
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? 'form');
      fields[key] ??= issue.message;
    }
    throw new ValidationError(fields);
  }
  const meta = parsed.data;
  toBaseUnits(meta.amount, meta.decimals);
  return meta;
}

export function toBaseUnits(amount: string, decimals: number): bigint {
  const value = BigInt(amount) * 10n ** BigInt(decimals);
  if (value > MAX_U64) {
    throw new ValidationError({ amount: 'Số lượng vượt giới hạn Uint64 (18.446.744.073.709.551.615 đơn vị nhỏ nhất)' });
  }
  return value;
}

export function applyTemplate(template: string, n: number): string {
  return template.replaceAll('{n}', String(n));
}

const IMAGE_TYPES: Record<string, { ext: string; matches: (b: Buffer) => boolean }> = {
  'image/png': { ext: 'png', matches: (b) => b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  'image/jpeg': { ext: 'jpg', matches: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  'image/webp': { ext: 'webp', matches: (b) => b.length > 12 && b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP' },
};

export function validateImage(buf: Buffer, mime: string): { sha256: string; mime: string; ext: string } {
  const type = IMAGE_TYPES[mime];
  if (!type) throw new ValidationError({ image: 'Ảnh phải là PNG, JPEG hoặc WEBP' });
  if (buf.length === 0) throw new ValidationError({ image: 'File ảnh rỗng' });
  if (buf.length > MAX_IMAGE_BYTES) throw new ValidationError({ image: 'Ảnh quá lớn (tối đa 5 MB)' });
  if (!type.matches(buf)) throw new ValidationError({ image: 'Nội dung file không đúng định dạng ảnh đã chọn' });
  return { sha256: createHash('sha256').update(buf).digest('hex'), mime, ext: type.ext };
}
