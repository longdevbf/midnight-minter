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

export interface ChainWallet {
  balances(sync: boolean): Promise<{ night: bigint; dust: bigint; synced: boolean }>;
  waitNight(min: bigint, timeoutMs: number): Promise<boolean>;
  ensureDust(): Promise<void>;
  transferNight(toAddress: string, amount: bigint): Promise<string>;
  deployToken(a: DeployArgs): Promise<{ contractAddress: string; txId: string }>;
  mintToken(a: MintArgs): Promise<{ txId: string; tokenColor: string; minted: bigint }>;
  close(): Promise<void>;
}

export interface Chain {
  open(network: NetworkConfig, mnemonic: string): Promise<ChainWallet>;
}
