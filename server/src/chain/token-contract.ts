import { createHmac } from 'node:crypto';
import { resolve } from 'node:path';
import { deployContract, findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { CompiledContract } from '@midnight-ntwrk/midnight-js-protocol/compact-js';
import type { CoinPublicKey, EncPublicKey, FinalizedTransaction } from '@midnight-ntwrk/midnight-js-protocol/ledger';
import type { MidnightProvider, UnboundTransaction, WalletProvider } from '@midnight-ntwrk/midnight-js-types';
import { ttlOneHour, validatePassword } from '@midnight-ntwrk/midnight-js-utils';
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

/**
 * Mật khẩu kho trạng thái riêng của midnight-js, dẫn xuất ổn định từ seedphrase (bí mật) của ví.
 * Không dùng địa chỉ công khai làm nguồn. Thư viện từ chối mật khẩu có chuỗi lặp/tăng giảm liên tiếp
 * nên thử lần lượt các ứng viên theo bộ đếm cho tới khi validatePassword (bản thật) chấp nhận.
 */
export function derivePrivateStatePassword(secret: string): string {
  for (let n = 0; n < 1000; n++) {
    const candidate = `Pk-${createHmac('sha256', secret).update(`minter:private-state:v1:${n}`).digest('hex').slice(0, 24)}`;
    try {
      validatePassword(candidate);
      return candidate;
    } catch {
      // validatePassword ném PasswordValidationError khi không hợp lệ: thử ứng viên kế tiếp.
    }
  }
  throw new Error('Không tạo được mật khẩu kho trạng thái hợp lệ');
}

export async function readTokenLedger(w: OpenWallet, contractAddress: string, privateStatePassword: string) {
  const providers = buildProviders(w, privateStatePassword);
  const state = await providers.publicDataProvider.queryContractState(contractAddress);
  if (!state) throw new Error('Không tìm thấy contract trên chuỗi (có thể giao dịch deploy chưa được xác nhận)');
  return ledger(state.data);
}

export async function deployToken(
  w: OpenWallet,
  a: DeployArgs,
  privateStatePassword: string,
): Promise<{ contractAddress: string; txId: string }> {
  const providers = buildProviders(w, privateStatePassword);
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

/** Phần ledger của contract token mà mintToken cần đọc. */
export type TokenLedgerView = Pick<ReturnType<typeof ledger>, 'minted' | 'minted_amount' | 'token_color'>;

export interface MintOptions {
  /** Số lần đọc lại ledger sau khi giao dịch mint xong (indexer có thể trễ). Mặc định 10. */
  attempts?: number;
  /** Nghỉ giữa hai lần đọc lại. Mặc định 3 giây. */
  delayMs?: number;
  /** Đọc ledger contract (tiêm được để kiểm thử). Mặc định readTokenLedger. */
  readLedger?: (w: OpenWallet, contractAddress: string, privateStatePassword: string) => Promise<TokenLedgerView>;
  /** Gửi giao dịch mint, chờ finalize và trả txId (tiêm được để kiểm thử). */
  submitMint?: (w: OpenWallet, a: MintArgs, privateStatePassword: string) => Promise<string>;
}

async function submitMintTx(w: OpenWallet, a: MintArgs, privateStatePassword: string): Promise<string> {
  const providers = buildProviders(w, privateStatePassword);
  const found = await findDeployedContract(providers, {
    contractAddress: a.contractAddress,
    compiledContract: compiled,
    privateStateId: PRIVATE_STATE_ID,
    initialPrivateState: {},
  });
  const result = await found.callTx.mint(a.ownerSecret, a.baseUnits, { bytes: w.keys.unshieldedAddressBytes });
  return result.public.txId;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function mintToken(
  w: OpenWallet,
  a: MintArgs,
  privateStatePassword: string,
  opts: MintOptions = {},
): Promise<{ txId: string; tokenColor: string; minted: bigint }> {
  const read = opts.readLedger ?? readTokenLedger;
  const attempts = opts.attempts ?? 10;
  const delayMs = opts.delayMs ?? 3_000;

  const before = await read(w, a.contractAddress, privateStatePassword);
  // Idempotent: nếu lần trước đã mint thành công nhưng app tắt trước khi ghi DB thì không mint lại.
  // Contract chỉ cho mint đúng một lần: nếu minted_amount khác a.baseUnits (bản ghi DB lệch với chuỗi) vẫn trả
  // "already-minted" cùng số lượng THẬT trên chuỗi (minted), không ném lỗi — mint lại là không thể.
  if (before.minted) {
    return { txId: 'already-minted', tokenColor: Buffer.from(before.token_color).toString('hex'), minted: before.minted_amount };
  }
  const txId = await (opts.submitMint ?? submitMintTx)(w, a, privateStatePassword);
  // Giao dịch đã finalize nhưng indexer có thể chưa kịp phản ánh: đọc lại vài lần, nếu không txId thật bị mất
  // (lần thử lại sau đó chỉ thấy "already-minted").
  for (let i = 0; i < attempts; i++) {
    if (i > 0) await sleep(delayMs);
    let after: TokenLedgerView;
    try {
      after = await read(w, a.contractAddress, privateStatePassword);
    } catch {
      continue; // lỗi đọc tạm thời (indexer trễ/502): thử lại ở vòng sau
    }
    if (after.minted && after.minted_amount === a.baseUnits) {
      return { txId, tokenColor: Buffer.from(after.token_color).toString('hex'), minted: after.minted_amount };
    }
  }
  throw new Error('Đã gửi giao dịch mint nhưng ledger trên chuỗi chưa phản ánh đúng số lượng');
}
