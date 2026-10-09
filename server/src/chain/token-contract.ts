import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { deployContract, findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { CompiledContract } from '@midnight-ntwrk/midnight-js-protocol/compact-js';
import type { CoinPublicKey, EncPublicKey, FinalizedTransaction } from '@midnight-ntwrk/midnight-js-protocol/ledger';
import type { MidnightProvider, UnboundTransaction, WalletProvider } from '@midnight-ntwrk/midnight-js-types';
import { ttlOneHour } from '@midnight-ntwrk/midnight-js-utils';
import { Contract, ledger } from '../../../managed/token/contract/index.js';
import type { DeployArgs, MintArgs } from './types';
import type { OpenWallet } from './wallet-runtime';

const ZK_DIR = resolve(import.meta.dirname, '../../../managed/token');
const PRIVATE_STATE_ID = 'token';

class MinterWalletProvider implements WalletProvider, MidnightProvider {
  constructor(private readonly w: OpenWallet) {}
  getCoinPublicKey(): CoinPublicKey {
    return this.w.keys.shielded.coinPublicKey;
  }
  getEncryptionPublicKey(): EncPublicKey {
    return this.w.keys.shielded.encryptionPublicKey;
  }
  async balanceTx(tx: UnboundTransaction, ttl: Date = ttlOneHour()): Promise<FinalizedTransaction> {
    const recipe = await this.w.facade.balanceUnboundTransaction(
      tx,
      { shieldedSecretKeys: this.w.keys.shielded, dustSecretKey: this.w.keys.dust },
      { ttl },
    );
    return this.w.facade.finalizeRecipe(recipe);
  }
  submitTx(tx: FinalizedTransaction): Promise<string> {
    return this.w.facade.submitTransaction(tx);
  }
}

const compiled = CompiledContract.withCompiledFileAssets(
  CompiledContract.withVacantWitnesses(CompiledContract.make('token', Contract)),
  ZK_DIR,
);

export function buildProviders(w: OpenWallet, privateStatePassword: string) {
  const zkConfigProvider = new NodeZkConfigProvider<'mint'>(ZK_DIR);
  const walletProvider = new MinterWalletProvider(w);
  const accountId = w.keys.unshieldedAddress;
  return {
    privateStateProvider: levelPrivateStateProvider({
      privateStateStoreName: `token-private-${accountId.slice(-12)}`,
      signingKeyStoreName: `token-signing-${accountId.slice(-12)}`,
      privateStoragePasswordProvider: () => privateStatePassword,
      accountId,
    }),
    publicDataProvider: indexerPublicDataProvider(w.network.indexerHttpUrl, w.network.indexerWsUrl),
    zkConfigProvider,
    proofProvider: httpClientProofProvider(w.network.proofServerUrl, zkConfigProvider),
    walletProvider,
    midnightProvider: walletProvider,
  };
}

/** Mật khẩu kho trạng thái riêng của midnight-js: dẫn xuất ổn định từ seed ví, đủ độ phức tạp. */
export function privateStatePasswordFor(w: OpenWallet): string {
  return `Pk-${createHash('sha256').update(w.keys.unshieldedAddress).digest('hex').slice(0, 24)}`;
}

export async function readTokenLedger(w: OpenWallet, contractAddress: string) {
  const providers = buildProviders(w, privateStatePasswordFor(w));
  const state = await providers.publicDataProvider.queryContractState(contractAddress);
  if (!state) throw new Error('Không tìm thấy contract trên chuỗi (có thể giao dịch deploy chưa được xác nhận)');
  return ledger(state.data);
}

export async function deployToken(w: OpenWallet, a: DeployArgs): Promise<{ contractAddress: string; txId: string }> {
  const providers = buildProviders(w, privateStatePasswordFor(w));
  const deployed = await deployContract(providers, {
    compiledContract: compiled,
    privateStateId: PRIVATE_STATE_ID,
    initialPrivateState: {},
    args: [a.ownerSecret, a.name, a.symbol, BigInt(a.decimals), a.imageUri, Buffer.from(a.imageSha256Hex, 'hex')],
  });
  return {
    contractAddress: deployed.deployTxData.public.contractAddress,
    txId: deployed.deployTxData.public.txId,
  };
}

export async function mintToken(
  w: OpenWallet,
  a: MintArgs,
): Promise<{ txId: string; tokenColor: string; minted: bigint }> {
  const before = await readTokenLedger(w, a.contractAddress);
  // Idempotent: nếu lần trước đã mint thành công nhưng app tắt trước khi ghi DB thì không mint lại.
  if (before.minted) {
    return { txId: 'already-minted', tokenColor: Buffer.from(before.token_color).toString('hex'), minted: before.minted_amount };
  }
  const providers = buildProviders(w, privateStatePasswordFor(w));
  const found = await findDeployedContract(providers, {
    contractAddress: a.contractAddress,
    compiledContract: compiled,
    privateStateId: PRIVATE_STATE_ID,
    initialPrivateState: {},
  });
  const result = await found.callTx.mint(a.ownerSecret, a.baseUnits, { bytes: w.keys.unshieldedAddressBytes });
  const after = await readTokenLedger(w, a.contractAddress);
  if (!after.minted || after.minted_amount !== a.baseUnits) {
    throw new Error('Đã gửi giao dịch mint nhưng ledger trên chuỗi chưa phản ánh đúng số lượng');
  }
  return { txId: result.public.txId, tokenColor: Buffer.from(after.token_color).toString('hex'), minted: after.minted_amount };
}
