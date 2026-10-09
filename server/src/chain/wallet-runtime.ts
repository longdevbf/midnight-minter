import './ws-polyfill';
import * as ledger from '@midnight-ntwrk/midnight-js-protocol/ledger';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import {
  DustWallet,
  MidnightBech32m,
  NoOpTransactionHistoryStorage,
  PublicKey,
  ShieldedWallet,
  UnshieldedAddress,
  UnshieldedWallet,
  WalletFacade,
} from '@midnightntwrk/wallet-sdk';
import * as Rx from 'rxjs';
import type { NetworkConfig } from '../config/networks';
import type { WalletKeys } from './keys';

const NIGHT = ledger.unshieldedToken().raw;

export interface OpenWallet {
  facade: WalletFacade;
  keys: WalletKeys;
  network: NetworkConfig;
  close(): Promise<void>;
}

export async function openWallet(network: NetworkConfig, keys: WalletKeys): Promise<OpenWallet> {
  setNetworkId(network.networkId);
  const indexerClientConnection = {
    indexerHttpUrl: network.indexerHttpUrl,
    indexerWsUrl: network.indexerWsUrl,
  };
  const shieldedConfig = {
    networkId: network.networkId,
    indexerClientConnection,
    provingServerUrl: new URL(network.proofServerUrl),
    relayURL: new URL(network.relayUrl),
  };
  const unshieldedConfig = {
    networkId: network.networkId,
    indexerClientConnection,
    txHistoryStorage: new NoOpTransactionHistoryStorage(),
  };
  const dustConfig = {
    ...shieldedConfig,
    costParameters: { additionalFeeOverhead: 300_000_000_000_000n, feeBlocksMargin: 5 },
  };

  const facade = await WalletFacade.init({
    configuration: { ...shieldedConfig, ...unshieldedConfig, ...dustConfig },
    shielded: (cfg) => ShieldedWallet(cfg).startWithSecretKeys(keys.shielded),
    unshielded: (cfg) => UnshieldedWallet(cfg).startWithPublicKey(PublicKey.fromKeyStore(keys.unshieldedKeystore)),
    dust: (cfg) => DustWallet(cfg).startWithSecretKey(keys.dust, ledger.LedgerParameters.initialParameters().dust),
  });
  try {
    await facade.start(keys.shielded, keys.dust);
  } catch (e) {
    // start chạy các dịch vụ song song: một cái lỗi thì cái khác vẫn chạy (socket indexer...), phải dừng hết.
    await facade.stop().catch(() => undefined);
    throw e;
  }
  return { facade, keys, network, close: () => facade.stop() };
}

export async function readBalances(w: OpenWallet, sync: boolean) {
  const state = sync ? await w.facade.waitForSyncedState() : await Rx.firstValueFrom(w.facade.state());
  return {
    synced: state.isSynced,
    night: state.unshielded.balances[NIGHT] ?? 0n,
    dust: state.dust.balance(new Date()),
  };
}

/** Chờ cho tới khi số dư NIGHT >= min (và ví đã đồng bộ). Trả false nếu hết thời gian. */
export async function waitNight(w: OpenWallet, min: bigint, timeoutMs: number): Promise<boolean> {
  try {
    await Rx.firstValueFrom(
      w.facade.state().pipe(
        Rx.filter((s) => s.isSynced && (s.unshielded.balances[NIGHT] ?? 0n) >= min),
        Rx.timeout(timeoutMs),
      ),
    );
    return true;
  } catch (e) {
    if (e instanceof Rx.TimeoutError) return false;
    throw e;
  }
}

async function waitDust(w: OpenWallet, timeoutMs: number): Promise<void> {
  try {
    await Rx.firstValueFrom(
      w.facade.state().pipe(
        Rx.filter((s) => s.isSynced && s.dust.balance(new Date()) > 0n),
        Rx.timeout(timeoutMs),
      ),
    );
  } catch (e) {
    if (e instanceof Rx.TimeoutError) throw new Error('Chờ DUST quá lâu (hơn 20 phút). Bấm Thử lại.');
    throw e;
  }
}

export async function ensureDust(w: OpenWallet, opts: { timeoutMs?: number } = {}): Promise<void> {
  const timeoutMs = opts.timeoutMs ?? 20 * 60_000;
  const state = await w.facade.waitForSyncedState();
  const unregistered = state.unshielded.availableCoins.filter((c) => !c.meta.registeredForDustGeneration);
  if (unregistered.length > 0) {
    // Lần đăng ký đầu tự trả phí bằng DUST mà NIGHT đã sinh ra từ lúc về ví, nên phải chờ đủ.
    const { fee } = await w.facade.estimateRegistration(unregistered);
    try {
      await w.facade.waitForGeneratedDust(unregistered, fee, { timeoutMs });
    } catch (e) {
      // SDK ném TimeoutError tiếng Anh ("Timeout has occurred") từ bản rxjs riêng của nó: so theo name.
      if (e instanceof Rx.TimeoutError || (e instanceof Error && e.name === 'TimeoutError')) {
        throw new Error('Chờ DUST sinh ra quá lâu. Bấm Thử lại.');
      }
      throw e;
    }
    const recipe = await w.facade.registerNightUtxosForDustGeneration(
      unregistered,
      w.keys.unshieldedKeystore.getPublicKey(),
      (payload) => w.keys.unshieldedKeystore.signData(payload),
    );
    const finalized = await w.facade.finalizeRecipe(recipe);
    await w.facade.submitTransaction(finalized);
  }
  await waitDust(w, timeoutMs);
}

export async function transferNight(w: OpenWallet, toBech32: string, amount: bigint): Promise<string> {
  const receiver = MidnightBech32m.parse(toBech32).decode(UnshieldedAddress, w.network.networkId);
  const recipe = await w.facade.transferTransaction(
    [{ type: 'unshielded', outputs: [{ type: NIGHT, receiverAddress: receiver, amount }] }],
    { shieldedSecretKeys: w.keys.shielded, dustSecretKey: w.keys.dust },
    { ttl: new Date(Date.now() + 30 * 60_000) },
  );
  // Đầu vào unshielded cần chữ ký của khóa NightExternal trước khi hoàn tất.
  const signed = await w.facade.signRecipe(recipe, (payload) => w.keys.unshieldedKeystore.signData(payload));
  const finalized = await w.facade.finalizeRecipe(signed);
  return w.facade.submitTransaction(finalized);
}
