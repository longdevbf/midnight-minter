import type { NetworkName } from './config/networks';

export type WalletKind = 'treasury' | 'child';
export type WalletStatus = 'created' | 'funding' | 'syncing' | 'dust_pending' | 'ready' | 'failed';
export type TokenStatus = 'queued' | 'deploying' | 'minting' | 'done' | 'failed';

export interface WalletRecord {
  id: string;
  label: string;
  kind: WalletKind;
  network: NetworkName;
  unshieldedAddress: string;
  encryptedMnemonic: string;
  status: WalletStatus;
  failedStep: string | null;
  message: string | null;
  /** đơn vị nhỏ nhất, dạng chuỗi số nguyên */
  nightBalance: string;
  dustBalance: string;
  createdAt: number;
}

export interface TokenRecord {
  id: string;
  walletId: string;
  name: string;
  symbol: string;
  decimals: number;
  amountWhole: string;
  baseUnits: string;
  imageUri: string;
  imageGatewayUrl: string;
  imageSha256: string;
  encryptedOwnerSecret: string;
  contractAddress: string | null;
  tokenColor: string | null;
  deployTxId: string | null;
  mintTxId: string | null;
  status: TokenStatus;
  failedStep: string | null;
  message: string | null;
  createdAt: number;
}

export type PublicWallet = Omit<WalletRecord, 'encryptedMnemonic'> & { tokenCount: number };
export type PublicToken = Omit<TokenRecord, 'encryptedOwnerSecret'>;

export function toPublicWallet(w: WalletRecord, tokenCount: number): PublicWallet {
  const { encryptedMnemonic: _omit, ...rest } = w;
  return { ...rest, tokenCount };
}

export function toPublicToken(t: TokenRecord): PublicToken {
  const { encryptedOwnerSecret: _omit, ...rest } = t;
  return rest;
}
