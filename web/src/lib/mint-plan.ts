/**
 * Kiểm tra nhanh phía giao diện cho form mint. Server (server/src/lib/metadata.ts và POST /api/mint)
 * vẫn là nơi quyết định; mọi quy tắc ở đây phản chiếu đúng quy tắc của server:
 *  - symbol: cắt khoảng trắng, kiểm tra /^[A-Za-z0-9]{1,12}$/ TRƯỚC khi viết hoa (nên 'ß' bị từ chối, không thành 'SS');
 *  - name: cắt khoảng trắng, 1–64 đơn vị UTF-16;
 *  - override không được thay {n}: giá trị override được dùng nguyên văn.
 */
const MAX_U64 = 18446744073709551615n;

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_WALLETS_PER_BATCH = 50;
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const SYMBOL_RE = /^[A-Za-z0-9]{1,12}$/;
const NAME_MAX = 64;

export interface Template {
  name: string;
  symbol: string;
  decimals: number;
  amount: string;
}

export interface PlanRow {
  walletId: string;
  name: string;
  symbol: string;
}

export type Overrides = Record<string, { name?: string; symbol?: string }>;
export type RowErrors = Record<string, { name?: string; symbol?: string }>;

const fill = (s: string, n: number) => s.replaceAll('{n}', String(n));

/** Symbol như server sẽ lưu: viết hoa chỉ khi hợp lệ, để ký tự sai định dạng (vd. 'ß') còn nguyên mà báo lỗi. */
const canonicalSymbol = (s: string) => (SYMBOL_RE.test(s) ? s.toUpperCase() : s);

/**
 * Xem trước name/symbol từng ví theo thứ tự chọn. Giá trị override dùng nguyên văn (không thay {n}),
 * kể cả chuỗi rỗng, giống `o?.name ?? applyTemplate(...)` của server.
 */
export function planNames(t: Template, walletIds: string[], overrides: Overrides = {}): PlanRow[] {
  return walletIds.map((walletId, i) => {
    const o = overrides[walletId];
    const name = (o?.name ?? fill(t.name, i + 1)).trim();
    const symbol = canonicalSymbol((o?.symbol ?? fill(t.symbol, i + 1)).trim());
    return { walletId, name, symbol };
  });
}

function nameError(name: string): string | undefined {
  if (!name) return 'Tên token không được để trống';
  if (name.length > NAME_MAX) return 'Tên token tối đa 64 ký tự';
  return undefined;
}

const SYMBOL_FORMAT = 'Symbol gồm 1–12 chữ cái/số, không dấu, không khoảng trắng';

export function validateTemplate(t: Template, walletCount: number, hasImage: boolean): Record<string, string> {
  const e: Record<string, string> = {};
  if (walletCount < 1) e.wallets = 'Chọn ít nhất một ví';
  else if (walletCount > MAX_WALLETS_PER_BATCH) e.wallets = `Tối đa ${MAX_WALLETS_PER_BATCH} ví mỗi lần`;

  // Số thứ tự lớn nhất cho chuỗi dài nhất: độ dài chỉ tăng theo n.
  const n = Math.max(walletCount, 1);
  const name = fill(t.name, n).trim();
  const nErr = nameError(name);
  if (nErr) e.name = name ? nErr : 'Nhập tên token';

  const sym = fill(t.symbol, n).trim();
  if (!sym) e.symbol = 'Nhập symbol';
  else if (sym.length > 12) e.symbol = 'Symbol tối đa 12 ký tự (kể cả số thứ tự)';
  else if (!SYMBOL_RE.test(sym)) e.symbol = SYMBOL_FORMAT;
  else if (walletCount > 1 && !t.symbol.includes('{n}')) e.symbol = 'Nhiều ví: symbol phải chứa {n} để mỗi ví một symbol riêng';

  if (!Number.isInteger(t.decimals) || t.decimals < 0 || t.decimals > 18) e.decimals = 'Decimals từ 0 đến 18';
  if (!/^[1-9][0-9]*$/.test(t.amount)) e.amount = 'Số lượng là số nguyên dương';
  else if (!e.decimals && BigInt(t.amount) * 10n ** BigInt(t.decimals) > MAX_U64) e.amount = 'Số lượng vượt giới hạn Uint64 sau khi nhân decimals';
  if (!hasImage) e.image = 'Chọn ảnh cho token';
  return e;
}

/**
 * Kiểm tra từng dòng sau khi áp override (mẫu có thể hợp lệ nhưng một override thì không),
 * và chặn symbol trùng trong lô như server. Khóa kết quả là walletId; dòng hợp lệ không có khóa.
 */
export function validateRows(rows: PlanRow[]): RowErrors {
  const errors: RowErrors = {};
  const bySymbol = new Map<string, string[]>();
  for (const r of rows) {
    const nErr = nameError(r.name);
    if (nErr) (errors[r.walletId] ??= {}).name = nErr;
    if (!SYMBOL_RE.test(r.symbol)) {
      (errors[r.walletId] ??= {}).symbol = r.symbol ? SYMBOL_FORMAT : 'Nhập symbol';
    } else {
      const ids = bySymbol.get(r.symbol) ?? [];
      ids.push(r.walletId);
      bySymbol.set(r.symbol, ids);
    }
  }
  for (const [symbol, ids] of bySymbol) {
    if (ids.length < 2) continue;
    for (const id of ids) (errors[id] ??= {}).symbol = `Symbol ${symbol} bị trùng trong lô. Mỗi ví cần một symbol riêng`;
  }
  return errors;
}

/** Cùng thông điệp với server (413 / 400) để người dùng thấy lỗi ngay khi chọn file. */
export function validateImageFile(file: { type: string; size: number }): string | null {
  if (!IMAGE_TYPES.includes(file.type)) return 'Ảnh phải là PNG, JPEG hoặc WEBP';
  if (file.size === 0) return 'File ảnh rỗng';
  if (file.size > MAX_IMAGE_BYTES) return 'Ảnh quá lớn (tối đa 5 MB)';
  return null;
}
