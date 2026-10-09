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
import type { WalletSnapshot } from './types';

const NIGHT = ledger.unshieldedToken().raw;

export interface OpenWallet {
  facade: WalletFacade;
  keys: WalletKeys;
  network: NetworkConfig;
  /** true chỉ khi ví thực sự khởi động từ snapshot (không phải đồng bộ lại từ đầu). */
  restored: boolean;
  close(): Promise<void>;
}

/** Hạn chờ lần phát state() đầu tiên để kiểm tra danh tính ví vừa khôi phục. */
const DEFAULT_IDENTITY_CHECK_TIMEOUT_MS = 60_000;

type InitParams = Parameters<typeof WalletFacade.init>[0];
type Builders = Pick<InitParams, 'shielded' | 'unshielded' | 'dust'>;

/** Dựng facade rồi start; start lỗi thì dừng facade (dịch vụ chạy song song: cái này lỗi, cái kia vẫn chạy). */
async function initAndStart(configuration: InitParams['configuration'], builders: Builders, keys: WalletKeys) {
  const facade = await WalletFacade.init({ configuration, ...builders });
  try {
    await facade.start(keys.shielded, keys.dust);
  } catch (e) {
    await facade.stop().catch(() => undefined);
    throw e;
  }
  return facade;
}

/**
 * Ví vừa khôi phục có đúng là ví của `keys` không: so địa chỉ unshielded và khóa công khai coin shielded
 * trong lần phát state() đầu tiên với khóa dẫn xuất từ seedphrase. Mọi lỗi/hết hạn coi như không khớp.
 */
async function identityMatches(facade: WalletFacade, keys: WalletKeys, network: NetworkConfig, timeoutMs: number) {
  try {
    const s = await Rx.firstValueFrom(facade.state().pipe(Rx.timeout(timeoutMs)));
    const unshielded = MidnightBech32m.encode(network.networkId, s.unshielded.address).asString();
    return unshielded === keys.unshieldedAddress && s.shielded.coinPublicKey.equals(keys.shielded.coinPublicKey);
  } catch {
    return false;
  }
}

/**
 * Thử khởi động từ snapshot. Trả null (sau khi đã dừng mọi thứ đã dựng) nếu snapshot hỏng, start lỗi
 * hoặc ví khôi phục không đúng danh tính: người gọi khi đó đồng bộ lại từ đầu.
 */
async function tryRestore(
  configuration: InitParams['configuration'],
  snapshot: WalletSnapshot,
  keys: WalletKeys,
  network: NetworkConfig,
  identityCheckTimeoutMs: number,
): Promise<WalletFacade | null> {
  // restore() giải mã trạng thái ngay khi dựng và ném nếu hỏng: ví con dựng trước đó phải được dừng.
  const built: Array<{ stop(): Promise<void> }> = [];
  const track = <T extends { stop(): Promise<void> }>(w: T): T => {
    built.push(w);
    return w;
  };
  let facade: WalletFacade;
  try {
    facade = await initAndStart(
      configuration,
      {
        shielded: (cfg) => track(ShieldedWallet(cfg).restore(snapshot.shielded)),
        unshielded: (cfg) => track(UnshieldedWallet(cfg).restore(snapshot.unshielded)),
        dust: (cfg) => track(DustWallet(cfg).restore(snapshot.dust)),
      },
      keys,
    );
  } catch {
    // initAndStart đã dừng facade nếu start lỗi; init lỗi thì chỉ còn các ví con đã dựng.
    await Promise.all(built.map((w) => w.stop().catch(() => undefined)));
    return null;
  }
  if (await identityMatches(facade, keys, network, identityCheckTimeoutMs)) return facade;
  await facade.stop().catch(() => undefined);
  return null;
}

export async function openWallet(
  network: NetworkConfig,
  keys: WalletKeys,
  snapshot?: WalletSnapshot,
  opts: { identityCheckTimeoutMs?: number } = {},
): Promise<OpenWallet> {
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
  const configuration = { ...shieldedConfig, ...unshieldedConfig, ...dustConfig };

  if (snapshot) {
    const restored = await tryRestore(
      configuration,
      snapshot,
      keys,
      network,
      opts.identityCheckTimeoutMs ?? DEFAULT_IDENTITY_CHECK_TIMEOUT_MS,
    );
    if (restored) return { facade: restored, keys, network, restored: true, close: () => restored.stop() };
  }

  const facade = await initAndStart(
    configuration,
    {
      shielded: (cfg) => ShieldedWallet(cfg).startWithSecretKeys(keys.shielded),
      unshielded: (cfg) => UnshieldedWallet(cfg).startWithPublicKey(PublicKey.fromKeyStore(keys.unshieldedKeystore)),
      dust: (cfg) => DustWallet(cfg).startWithSecretKey(keys.dust, ledger.LedgerParameters.initialParameters().dust),
    },
    keys,
  );
  return { facade, keys, network, restored: false, close: () => facade.stop() };
}

/** Chụp trạng thái ba ví con để lần mở sau khôi phục (xem openWallet). */
export async function snapshotWallet(w: OpenWallet): Promise<WalletSnapshot> {
  const [shielded, unshielded, dust] = await Promise.all([
    w.facade.shielded.serializeState(),
    w.facade.unshielded.serializeState(),
    w.facade.dust.serializeState(),
  ]);
  return { shielded, unshielded, dust };
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
