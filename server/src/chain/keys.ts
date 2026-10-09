import * as ledger from '@midnight-ntwrk/midnight-js-protocol/ledger';
import {
  HDWallet,
  Roles,
  createKeystore,
  generateMnemonicWords,
  joinMnemonicWords,
  validateMnemonic,
} from '@midnightntwrk/wallet-sdk';
import { mnemonicToSeed } from '@scure/bip39';

export type UnshieldedKeystore = ReturnType<typeof createKeystore>;

export interface WalletKeys {
  shielded: ledger.ZswapSecretKeys;
  dust: ledger.DustSecretKey;
  unshieldedKeystore: UnshieldedKeystore;
  unshieldedAddress: string;
  unshieldedAddressBytes: Uint8Array;
}

export function newMnemonic(): string {
  return joinMnemonicWords(generateMnemonicWords(256));
}

export async function deriveKeys(mnemonic: string, networkId: string): Promise<WalletKeys> {
  const normalized = mnemonic.trim().split(/\s+/).join(' ');
  if (!validateMnemonic(normalized)) throw new Error('Seedphrase không hợp lệ');
  // Seed 64 byte chuẩn BIP-39: cho cùng địa chỉ với Lace/1AM khi nhập cùng seedphrase.
  const seed = await mnemonicToSeed(normalized);
  const hd = HDWallet.fromSeed(seed);
  if (hd.type !== 'seedOk') throw new Error('Không tạo được khóa gốc từ seedphrase');
  const derived = hd.hdWallet
    .selectAccount(0)
    .selectRoles([Roles.Zswap, Roles.NightExternal, Roles.Dust])
    .deriveKeysAt(0);
  hd.hdWallet.clear();
  if (derived.type !== 'keysDerived') throw new Error('Không dẫn xuất được khóa ví');

  const keystore = createKeystore(derived.keys[Roles.NightExternal], networkId);
  const addressHex = ledger.addressFromKey(keystore.getPublicKey());
  return {
    shielded: ledger.ZswapSecretKeys.fromSeed(derived.keys[Roles.Zswap]),
    dust: ledger.DustSecretKey.fromSeed(derived.keys[Roles.Dust]),
    unshieldedKeystore: keystore,
    unshieldedAddress: keystore.getBech32Address().toString(),
    unshieldedAddressBytes: Buffer.from(addressHex, 'hex'),
  };
}
