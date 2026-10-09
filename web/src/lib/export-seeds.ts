export interface ExportedWallet {
  label: string;
  kind: 'child' | 'treasury';
  network: string;
  unshieldedAddress: string;
  mnemonic: string;
}

/** Nội dung file tải về: JSON dễ đọc, mỗi ví một phần tử, theo thứ tự tạo. */
export function exportJson(rows: ExportedWallet[]): string {
  return JSON.stringify(rows, null, 2) + '\n';
}

export function exportFilename(now: Date = new Date()): string {
  return `midnight-minter-seedphrase-${now.toISOString().slice(0, 10)}.json`;
}
