import * as Rx from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * SDK giả: ShieldedWallet/UnshieldedWallet/DustWallet ghi lại cách khởi động (restore hay theo khóa),
 * WalletFacade.init gọi đúng ba hàm khởi tạo như SDK thật rồi trả facade giả có start/stop/state/serializeState.
 */
type Kind = 'shielded' | 'unshielded' | 'dust';
interface SubWallet {
  kind: Kind;
  mode: 'restore' | 'keys';
  stop: ReturnType<typeof vi.fn>;
}
interface FakeFacade {
  modes: string[];
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  state: () => Rx.Observable<unknown>;
  shielded: { serializeState: () => Promise<string> };
  unshielded: { serializeState: () => Promise<string> };
  dust: { serializeState: () => Promise<string> };
}

const sdk = vi.hoisted(() => ({
  log: [] as string[],
  /** ví con nào ném lỗi khi restore (snapshot hỏng) */
  restoreThrows: null as null | 'shielded' | 'unshielded' | 'dust',
  /** lần start thứ i (0-based) có ném lỗi không */
  startErrors: [] as Array<Error | null>,
  /** state() của facade thứ i phát ra gì (mặc định: cái do test đặt ở `stateFor`) */
  states: [] as Array<() => unknown>,
  facades: [] as unknown[],
  subWallets: [] as unknown[],
}));

vi.mock('@midnightntwrk/wallet-sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@midnightntwrk/wallet-sdk')>();
  const make = (kind: Kind, mode: 'restore' | 'keys'): SubWallet => {
    const w: SubWallet = { kind, mode, stop: vi.fn(async () => undefined) };
    sdk.subWallets.push(w);
    return w;
  };
  const cls = (kind: Kind) => () => ({
    startWithSecretKeys: () => (sdk.log.push(`${kind}:keys`), make(kind, 'keys')),
    startWithPublicKey: () => (sdk.log.push(`${kind}:keys`), make(kind, 'keys')),
    startWithSecretKey: () => (sdk.log.push(`${kind}:keys`), make(kind, 'keys')),
    restore: (s: string) => {
      sdk.log.push(`${kind}:restore:${s}`);
      if (sdk.restoreThrows === kind) throw new Error('trạng thái hỏng');
      return make(kind, 'restore');
    },
  });
  return {
    ...actual,
    ShieldedWallet: cls('shielded'),
    UnshieldedWallet: cls('unshielded'),
    DustWallet: cls('dust'),
    WalletFacade: {
      init: vi.fn(async (p: Record<Kind, (cfg: unknown) => SubWallet> & { configuration: unknown }) => {
        const subs = [p.shielded(p.configuration), p.unshielded(p.configuration), p.dust(p.configuration)];
        const index = sdk.facades.length;
        const f: FakeFacade = {
          modes: subs.map((s) => `${s.kind}:${s.mode}`),
          start: vi.fn(async () => {
            const err = sdk.startErrors[index];
            if (err) throw err;
          }),
          stop: vi.fn(async () => undefined),
          state: () => {
            const make = sdk.states[index];
            return make ? (make() as Rx.Observable<unknown>) : Rx.NEVER;
          },
          shielded: { serializeState: async () => `S#${index}` },
          unshielded: { serializeState: async () => `U#${index}` },
          dust: { serializeState: async () => `D#${index}` },
        };
        sdk.facades.push(f);
        return f;
      }),
    },
  };
});

import { ShieldedCoinPublicKey, UnshieldedAddress, WalletFacade } from '@midnightntwrk/wallet-sdk';
import { deriveKeys, newMnemonic, type WalletKeys } from '../src/chain/keys';
import { getNetworkConfig } from '../src/config/networks';
import { openWallet, snapshotWallet } from '../src/chain/wallet-runtime';

const network = getNetworkConfig('preview', {});
const SNAP = { shielded: 'snapS', unshielded: 'snapU', dust: 'snapD' };

/** state() khớp danh tính của `keys` (như ví khôi phục đúng). */
const identityOf = (keys: WalletKeys) => () =>
  Rx.of({
    isSynced: false,
    unshielded: { address: new UnshieldedAddress(Buffer.from(keys.unshieldedAddressBytes)) },
    shielded: { coinPublicKey: ShieldedCoinPublicKey.fromHexString(keys.shielded.coinPublicKey) },
  });

const facades = () => sdk.facades as FakeFacade[];
const subWallets = () => sdk.subWallets as SubWallet[];

describe('openWallet: khôi phục từ snapshot, lỗi thì tự đồng bộ lại từ đầu (R1)', () => {
  let keys: WalletKeys;

  beforeEach(async () => {
    sdk.log.length = 0;
    sdk.restoreThrows = null;
    sdk.startErrors = [];
    sdk.states = [];
    sdk.facades.length = 0;
    sdk.subWallets.length = 0;
    vi.mocked(WalletFacade.init).mockClear();
    keys = await deriveKeys(newMnemonic(), network.networkId);
  });

  it('không có snapshot: khởi động theo khóa như trước, restored = false', async () => {
    const w = await openWallet(network, keys);
    expect(w.restored).toBe(false);
    expect(sdk.log).toEqual(['shielded:keys', 'unshielded:keys', 'dust:keys']);
    expect(facades()).toHaveLength(1);
    expect(facades()[0].start).toHaveBeenCalledWith(keys.shielded, keys.dust);
    await w.close();
    expect(facades()[0].stop).toHaveBeenCalledTimes(1);
  });

  it('snapshot đúng ví: ba ví con dùng restore, start bằng khóa như cũ, restored = true', async () => {
    sdk.states[0] = identityOf(keys);
    const w = await openWallet(network, keys, SNAP);
    expect(w.restored).toBe(true);
    expect(sdk.log).toEqual(['shielded:restore:snapS', 'unshielded:restore:snapU', 'dust:restore:snapD']);
    expect(facades()).toHaveLength(1);
    expect(facades()[0].start).toHaveBeenCalledWith(keys.shielded, keys.dust);
    expect(facades()[0].stop).not.toHaveBeenCalled();
    expect(await snapshotWallet(w)).toEqual({ shielded: 'S#0', unshielded: 'U#0', dust: 'D#0' });
    await w.close();
  });

  it('restore ném lỗi (snapshot hỏng): dừng ví con đã dựng, đồng bộ lại từ đầu, restored = false', async () => {
    sdk.restoreThrows = 'unshielded';
    const w = await openWallet(network, keys, SNAP);
    expect(w.restored).toBe(false);
    expect(sdk.log).toEqual([
      'shielded:restore:snapS', 'unshielded:restore:snapU',
      'shielded:keys', 'unshielded:keys', 'dust:keys',
    ]);
    // ví shielded đã dựng từ snapshot trước khi unshielded lỗi: phải được dừng
    const restoredShielded = subWallets().find((s) => s.kind === 'shielded' && s.mode === 'restore')!;
    expect(restoredShielded.stop).toHaveBeenCalledTimes(1);
    expect(facades()).toHaveLength(1);
    expect(facades()[0].modes).toEqual(['shielded:keys', 'unshielded:keys', 'dust:keys']);
    expect(facades()[0].start).toHaveBeenCalledTimes(1);
    await w.close();
  });

  it('start lỗi khi khôi phục: stop facade dở dang rồi đồng bộ lại từ đầu', async () => {
    sdk.startErrors[0] = new Error('khôi phục lỗi');
    const w = await openWallet(network, keys, SNAP);
    expect(w.restored).toBe(false);
    expect(facades()).toHaveLength(2);
    expect(facades()[0].modes).toEqual(['shielded:restore', 'unshielded:restore', 'dust:restore']);
    expect(facades()[0].stop).toHaveBeenCalledTimes(1);
    expect(facades()[1].modes).toEqual(['shielded:keys', 'unshielded:keys', 'dust:keys']);
    expect(facades()[1].stop).not.toHaveBeenCalled();
    await w.close();
    expect(facades()[1].stop).toHaveBeenCalledTimes(1);
  });

  it('snapshot của ví khác (sai danh tính): dừng ví khôi phục, đồng bộ lại từ đầu', async () => {
    const other = await deriveKeys(newMnemonic(), network.networkId);
    sdk.states[0] = identityOf(other);
    const w = await openWallet(network, keys, SNAP);
    expect(w.restored).toBe(false);
    expect(facades()).toHaveLength(2);
    expect(facades()[0].stop).toHaveBeenCalledTimes(1);
    expect(facades()[1].modes).toEqual(['shielded:keys', 'unshielded:keys', 'dust:keys']);
    await w.close();
  });

  it('chỉ địa chỉ unshielded khớp còn khóa shielded không khớp: vẫn coi là sai, đồng bộ lại', async () => {
    const other = await deriveKeys(newMnemonic(), network.networkId);
    sdk.states[0] = () =>
      Rx.of({
        unshielded: { address: new UnshieldedAddress(Buffer.from(keys.unshieldedAddressBytes)) },
        shielded: { coinPublicKey: ShieldedCoinPublicKey.fromHexString(other.shielded.coinPublicKey) },
      });
    const w = await openWallet(network, keys, SNAP);
    expect(w.restored).toBe(false);
    expect(facades()[0].stop).toHaveBeenCalledTimes(1);
    await w.close();
  });

  it('state() lỗi hoặc không phát gì trong hạn kiểm tra: đồng bộ lại từ đầu', async () => {
    sdk.states[0] = () => Rx.throwError(() => new Error('state hỏng'));
    const a = await openWallet(network, keys, SNAP);
    expect(a.restored).toBe(false);
    expect(facades()[0].stop).toHaveBeenCalledTimes(1);
    await a.close();

    sdk.states[2] = () => Rx.NEVER;
    const b = await openWallet(network, keys, SNAP, { identityCheckTimeoutMs: 20 });
    expect(b.restored).toBe(false);
    expect(facades()[2].stop).toHaveBeenCalledTimes(1);
    expect(facades()[3].modes).toEqual(['shielded:keys', 'unshielded:keys', 'dust:keys']);
    await b.close();
  });

  it('khôi phục lỗi rồi đồng bộ lại cũng lỗi: ném lỗi của lần đồng bộ lại, mọi facade đều đã dừng', async () => {
    const boom = new Error('indexer chết');
    sdk.startErrors[0] = new Error('khôi phục lỗi');
    sdk.startErrors[1] = boom;
    await expect(openWallet(network, keys, SNAP)).rejects.toBe(boom);
    expect(facades()).toHaveLength(2);
    expect(facades()[0].stop).toHaveBeenCalledTimes(1);
    expect(facades()[1].stop).toHaveBeenCalledTimes(1);
  });
});
