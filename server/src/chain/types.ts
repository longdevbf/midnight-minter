import type { NetworkConfig } from '../config/networks';

export interface DeployArgs {
  ownerSecret: Uint8Array;
  name: string;
  symbol: string;
  decimals: number;
  imageUri: string;
  imageSha256Hex: string;
}

export interface MintArgs {
  contractAddress: string;
  ownerSecret: Uint8Array;
  baseUnits: bigint;
}

/**
 * Trạng thái đã đồng bộ của ba ví con (shielded/unshielded/dust) theo định dạng serializeState() của SDK.
 * Chứa thông tin riêng tư của ví: chỉ được lưu sau khi mã hóa bằng vault.
 */
export interface WalletSnapshot {
  shielded: string;
  unshielded: string;
  dust: string;
}

/**
 * snapshot() từ chối chụp vì ví còn giao dịch chờ (coin đang đặt chỗ/đang tiêu, giao dịch chưa có kết quả).
 * Không phải lỗi: người gọi giữ nguyên snapshot cũ (sạch) và thử lại lần sau.
 */
export class SnapshotSkipped extends Error {
  constructor(message = 'Ví còn giao dịch chờ, bỏ qua lưu snapshot') {
    super(message);
    this.name = 'SnapshotSkipped';
  }
}

export interface ChainWallet {
  /** true chỉ khi lần mở này thực sự khởi động từ snapshot (không phải đồng bộ lại từ đầu). */
  readonly restored: boolean;
  /**
   * Chụp trạng thái hiện tại của ba ví con (để lần mở sau khỏi đồng bộ lại từ đầu).
   * Ném SnapshotSkipped khi ví còn giao dịch chờ (xem wallet-runtime.snapshotWallet).
   */
  snapshot(): Promise<WalletSnapshot>;
  balances(sync: boolean): Promise<{ night: bigint; dust: bigint; synced: boolean }>;
  waitNight(min: bigint, timeoutMs: number): Promise<boolean>;
  ensureDust(): Promise<void>;
  transferNight(toAddress: string, amount: bigint): Promise<string>;
  deployToken(a: DeployArgs): Promise<{ contractAddress: string; txId: string }>;
  mintToken(a: MintArgs): Promise<{ txId: string; tokenColor: string; minted: bigint }>;
  close(): Promise<void>;
}

export interface Chain {
  /** Có `snapshot` thì thử khôi phục từ đó; khôi phục không được thì tự đồng bộ lại từ đầu (restored = false). */
  open(network: NetworkConfig, mnemonic: string, snapshot?: WalletSnapshot): Promise<ChainWallet>;
}
