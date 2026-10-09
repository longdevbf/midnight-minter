import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { Engine, SDK_STATE_VERSION, type EngineDeps } from '../src/engine/engine';
import { openStore, type Store } from '../src/db/store';
import { createVault, makeSalt, type Vault } from '../src/lib/vault';
import { getNetworkConfig } from '../src/config/networks';
import { fakeSnapshotOf, makeFakeChain } from './fake-chain';
import type { TokenRecord } from '../src/types';

const FUND = 100_000_000n;
const network = getNetworkConfig('preview', {});

type SetupOpts = Partial<Omit<EngineDeps, 'store' | 'vault' | 'chain' | 'network' | 'bus' | 'fundAmount'>>;
type Ctx = ReturnType<typeof setup>;

function setup(opts: SetupOpts = {}, shared?: { store: Store; vault: Vault; fake: ReturnType<typeof makeFakeChain> }) {
  const store = shared?.store ?? openStore(':memory:');
  const vault = shared?.vault ?? createVault('mat-khau-chu-123', makeSalt());
  const fake = shared?.fake ?? makeFakeChain();
  const saves: string[] = [];
  const realSet = store.setWalletState.bind(store);
  // ghi lại thứ tự lưu (theo id ví) để kiểm tra điều tiết/lưu ép buộc
  store.setWalletState = (id, rec) => {
    saves.push(id);
    realSet(id, rec);
  };
  const engine = new Engine({
    store, vault, chain: fake.chain, network, bus: new EventEmitter(), fundAmount: FUND, waitFundMs: 10,
    snapshotMinIntervalMs: 0, ...opts,
  });
  return { store, vault, fake, engine, saves };
}

const mnemonicOf = (ctx: Ctx, id: string) => ctx.vault.decrypt(ctx.store.getWallet(id)!.encryptedMnemonic);
const savesOf = (ctx: Ctx, id: string) => ctx.saves.filter((x) => x === id).length;
const lastOpenSnapshot = (ctx: Ctx) => ctx.fake.state.openSnapshots[ctx.fake.state.openSnapshots.length - 1];

async function readyTreasury(ctx: Ctx, night = 1_000_000_000n) {
  const [t] = await ctx.engine.createWallets(1, 'treasury');
  await ctx.engine.idle();
  ctx.fake.state.night.set(mnemonicOf(ctx, t.id), night);
  ctx.engine.retryWallet(t.id);
  await ctx.engine.idle();
  expect(ctx.store.getWallet(t.id)!.status).toBe('ready');
  return t.id;
}

/** Engine mới trên CÙNG store/vault/chain giả (như khởi động lại app). */
function restart(ctx: Ctx, opts: SetupOpts = {}): Ctx {
  return setup(opts, { store: ctx.store, vault: ctx.vault, fake: ctx.fake });
}

const token = (walletId: string, vault: Vault, over: Partial<TokenRecord> = {}): TokenRecord => ({
  id: 'tok1', walletId, name: 'Papa', symbol: 'PAPA', decimals: 6, amountWhole: '10', baseUnits: '10000000',
  imageUri: 'ipfs://cid', imageGatewayUrl: 'https://gw/ipfs/cid', imageSha256: 'ab'.repeat(32),
  encryptedOwnerSecret: vault.encrypt('cd'.repeat(32)),
  contractAddress: null, tokenColor: null, deployTxId: null, mintTxId: null,
  status: 'queued', failedStep: null, message: null, createdAt: Date.now(), ...over,
});

describe('Engine — lưu snapshot ví đã đồng bộ (R1)', () => {
  it('ví tới ready: snapshot được lưu, mã hóa bằng vault, đúng network và sdk_version', async () => {
    const ctx = setup();
    const id = await readyTreasury(ctx);
    const row = ctx.store.getWalletState(id)!;
    expect(row).not.toBeNull();
    expect(row.network).toBe(network.name);
    expect(row.sdkVersion).toBe(SDK_STATE_VERSION);
    expect(row.savedAt).toBeGreaterThan(0);
    const mnemonic = mnemonicOf(ctx, id);
    const stub = fakeSnapshotOf(mnemonic);
    // không phải văn bản thường: không chứa nội dung snapshot, cũng không chứa seedphrase
    expect(row.blob.startsWith('v1:')).toBe(true);
    for (const part of Object.values(stub)) expect(row.blob).not.toContain(part);
    expect(row.blob).not.toContain(mnemonic.split(' ')[0]);
    expect(JSON.parse(ctx.vault.decrypt(row.blob))).toEqual(stub);
    await ctx.engine.closeAll();
  });

  it('lần mở đầu không có snapshot; sau closeAll(), Engine mới trên cùng CSDL mở ví bằng snapshot đã lưu', async () => {
    const ctx = setup();
    const id = await readyTreasury(ctx);
    expect(ctx.fake.state.openSnapshots).toEqual([null]);
    await ctx.engine.closeAll();

    const next = restart(ctx);
    next.engine.refreshWallet(id);
    await next.engine.idle();
    expect(ctx.fake.state.openSnapshots).toHaveLength(2);
    expect(lastOpenSnapshot(next)).toEqual(fakeSnapshotOf(mnemonicOf(next, id)));
    expect(next.store.getWallet(id)!.message).toBeNull();
    expect(next.store.getWalletState(id)).not.toBeNull(); // snapshot dùng được thì giữ (và được làm mới)
    await next.engine.closeAll();
  });

  const badBlobs: Array<[string, (v: Vault) => string]> = [
    ['blob hỏng', () => 'v1:AAAA:BBBB:CCCC'],
    ['mã hóa bằng vault khác', () => createVault('mot-mat-khau-khac', makeSalt()).encrypt(JSON.stringify({ shielded: 'a', unshielded: 'b', dust: 'c' }))],
    ['không phải JSON', (v) => v.encrypt('không phải json')],
    ['JSON sai hình dạng', (v) => v.encrypt(JSON.stringify({ shielded: 1, unshielded: 'b', dust: 'c' }))],
    ['JSON thiếu trường', (v) => v.encrypt(JSON.stringify({ shielded: 'a', unshielded: 'b' }))],
    ['JSON là null', (v) => v.encrypt('null')],
  ];
  it.each(badBlobs)('%s: mở ví KHÔNG dùng snapshot và xoá dòng', async (_name, makeBlob) => {
    const ctx = setup();
    const id = await readyTreasury(ctx);
    await ctx.engine.closeAll();
    ctx.store.setWalletState(id, { network: network.name, sdkVersion: SDK_STATE_VERSION, blob: makeBlob(ctx.vault), savedAt: 1 });

    const next = restart(ctx);
    next.fake.state.failOnce.add('balances'); // lần làm mới không đồng bộ xong => không lưu snapshot mới
    next.engine.refreshWallet(id);
    await next.engine.idle();
    expect(lastOpenSnapshot(next)).toBeNull();
    expect(next.store.getWalletState(id)).toBeNull();
    await next.engine.closeAll();
  });

  it.each([
    ['network khác', { network: 'preprod' }],
    ['sdk_version khác', { sdkVersion: '@midnightntwrk/wallet-sdk@0.9.0' }],
  ])('%s: bỏ qua snapshot và xoá dòng', async (_name, over) => {
    const ctx = setup();
    const id = await readyTreasury(ctx);
    await ctx.engine.closeAll();
    const row = ctx.store.getWalletState(id)!;
    ctx.store.setWalletState(id, { ...row, ...over });

    const next = restart(ctx);
    next.fake.state.failOnce.add('balances');
    next.engine.refreshWallet(id);
    await next.engine.idle();
    expect(lastOpenSnapshot(next)).toBeNull();
    expect(next.store.getWalletState(id)).toBeNull();
    await next.engine.closeAll();
  });

  it('chain không khôi phục được (rejectSnapshot): xoá dòng cũ, ví vẫn dùng được và lưu lại snapshot mới', async () => {
    const ctx = setup();
    const id = await readyTreasury(ctx);
    await ctx.engine.closeAll();
    const deleted = vi.spyOn(ctx.store, 'deleteWalletState');

    const next = restart(ctx);
    next.fake.state.rejectSnapshot = true;
    next.engine.refreshWallet(id);
    await next.engine.idle();
    expect(lastOpenSnapshot(next)).not.toBeNull(); // đã thử snapshot
    expect(deleted).toHaveBeenCalledWith(id);
    expect(next.store.getWallet(id)!.message).toBeNull();

    // ví vẫn mint được
    next.store.insertToken(token(id, next.vault));
    next.engine.enqueueToken('tok1');
    await next.engine.idle();
    expect(next.store.getToken('tok1')!.status).toBe('done');
    expect(next.store.getWalletState(id)).not.toBeNull();
    await next.engine.closeAll();
  });

  it('điều tiết: hai lần đồng bộ trong khoảng tối thiểu chỉ lưu một lần; lưu ép buộc (token done, closeAll) bỏ qua điều tiết', async () => {
    const ctx = setup({ snapshotMinIntervalMs: 60_000 });
    const id = await readyTreasury(ctx);
    const afterReady = savesOf(ctx, id);
    expect(afterReady).toBeGreaterThanOrEqual(1);

    ctx.engine.refreshWallet(id);
    await ctx.engine.idle();
    ctx.engine.refreshWallet(id);
    await ctx.engine.idle();
    expect(savesOf(ctx, id)).toBe(afterReady); // đồng bộ thêm hai lần, vẫn trong khoảng tối thiểu

    ctx.store.insertToken(token(id, ctx.vault));
    ctx.engine.enqueueToken('tok1');
    await ctx.engine.idle();
    expect(ctx.store.getToken('tok1')!.status).toBe('done');
    expect(savesOf(ctx, id)).toBe(afterReady + 1); // token done: lưu ép buộc

    await ctx.engine.closeAll();
    expect(savesOf(ctx, id)).toBe(afterReady + 2); // closeAll: lưu ép buộc
  });

  it('không điều tiết (khoảng = 0): mỗi lần đồng bộ xong đều lưu', async () => {
    const ctx = setup();
    const id = await readyTreasury(ctx);
    const before = savesOf(ctx, id);
    ctx.engine.refreshWallet(id);
    await ctx.engine.idle();
    expect(savesOf(ctx, id)).toBe(before + 1);
    await ctx.engine.closeAll();
  });

  it('ensureDust xong: lưu ép buộc dù đang trong khoảng điều tiết', async () => {
    const ctx = setup({ snapshotMinIntervalMs: 60_000 });
    const [t] = await ctx.engine.createWallets(1, 'treasury');
    await ctx.engine.idle(); // funding: đã đồng bộ một lần và lưu
    expect(savesOf(ctx, t.id)).toBe(1);
    ctx.fake.state.night.set(mnemonicOf(ctx, t.id), 1_000_000_000n);
    ctx.engine.retryWallet(t.id);
    await ctx.engine.idle();
    // funding + syncing (bị điều tiết), ensureDust (ép buộc) => đúng 2 lần
    expect(savesOf(ctx, t.id)).toBe(2);
    await ctx.engine.closeAll();
  });

  it('trim(): ví bị đóng bớt được lưu ngay trước khi đóng', async () => {
    const ctx = setup({ snapshotMinIntervalMs: 60_000, maxOpenWallets: 2 });
    await readyTreasury(ctx);
    const [c1] = await ctx.engine.createWallets(1, 'child');
    await ctx.engine.idle();
    const m1 = mnemonicOf(ctx, c1.id);
    const before = savesOf(ctx, c1.id);
    let closedAtSave: boolean | null = null;
    const inner = ctx.store.setWalletState;
    ctx.store.setWalletState = (id, rec) => {
      if (id === c1.id) closedAtSave = ctx.fake.state.closedMnemonics.includes(m1);
      inner(id, rec);
    };

    await ctx.engine.createWallets(1, 'child'); // mở ví thứ 3 => đóng bớt c1
    await ctx.engine.idle();
    expect(ctx.fake.state.closedMnemonics).toContain(m1);
    expect(savesOf(ctx, c1.id)).toBe(before + 1);
    expect(closedAtSave).toBe(false); // lưu TRƯỚC khi đóng
    await ctx.engine.closeAll();
  });

  it('closeAll(): chỉ lưu ví đã đồng bộ xong trong tiến trình này', async () => {
    const ctx = setup();
    const id = await readyTreasury(ctx);
    await ctx.engine.closeAll();
    const savedBefore = ctx.store.getWalletState(id)!;

    const next = restart(ctx);
    next.fake.state.failOnce.add('balances'); // mở được (bằng snapshot) nhưng đồng bộ lỗi
    next.engine.refreshWallet(id);
    await next.engine.idle();
    const calls = next.fake.state.snapshotCalls;
    await next.engine.closeAll();
    expect(next.fake.state.snapshotCalls).toBe(calls); // không chụp ví chưa đồng bộ xong
    expect(next.store.getWalletState(id)).toEqual(savedBefore); // snapshot cũ còn nguyên
  });

  it('snapshot() lỗi không làm hỏng job nào (ví ready, token done), không có dòng nào được ghi', async () => {
    const ctx = setup();
    ctx.fake.state.failCount.set('snapshot', 1_000);
    const id = await readyTreasury(ctx);
    expect(ctx.store.getWallet(id)!.message).toBeNull();
    ctx.store.insertToken(token(id, ctx.vault));
    ctx.engine.enqueueToken('tok1');
    await ctx.engine.idle();
    expect(ctx.store.getToken('tok1')!.status).toBe('done');
    await ctx.engine.closeAll();
    expect(ctx.fake.state.snapshotCalls).toBeGreaterThan(0);
    expect(ctx.store.getWalletState(id)).toBeNull();
  });

  it('snapshot() treo: bị giới hạn thời gian, job vẫn xong và closeAll() không treo', async () => {
    const ctx = setup({ snapshotTimeoutMs: 20 });
    ctx.fake.state.hang.add('snapshot');
    const id = await readyTreasury(ctx);
    expect(ctx.store.getWallet(id)!.message).toBeNull();
    await ctx.engine.closeAll();
    expect(ctx.fake.state.closed).toBe(1);
    expect(ctx.store.getWalletState(id)).toBeNull();
  });

  it('ensureDust quá hạn => ví bị loại: được lưu trước khi đóng, snapshot treo cũng không làm treo', async () => {
    const ctx = setup({ chainCallTimeoutMs: 10_000, dustTimeoutMs: 40, snapshotTimeoutMs: 20 });
    await readyTreasury(ctx);
    ctx.fake.state.hang.add('ensureDust');
    ctx.fake.state.hang.add('snapshot');
    const closedBefore = ctx.fake.state.closed;
    const callsBefore = ctx.fake.state.snapshotCalls;
    const [c] = await ctx.engine.createWallets(1, 'child');
    await ctx.engine.idle();
    const w = ctx.store.getWallet(c.id)!;
    expect(w.status).toBe('failed');
    expect(w.failedStep).toBe('dust_pending');
    expect(w.message).toMatch(/quá thời gian chờ/);
    expect(ctx.fake.state.closed).toBeGreaterThan(closedBefore);
    expect(ctx.fake.state.closedMnemonics).toContain(mnemonicOf(ctx, c.id));
    expect(ctx.fake.state.snapshotCalls).toBeGreaterThan(callsBefore); // đã thử lưu trước khi đóng
    await ctx.engine.closeAll();
  });

  it('ensureDust quá hạn => ví bị loại: snapshot dùng được thì lưu trước khi đóng', async () => {
    const ctx = setup({ chainCallTimeoutMs: 10_000, dustTimeoutMs: 40, snapshotMinIntervalMs: 60_000 });
    await readyTreasury(ctx);
    ctx.fake.state.hang.add('ensureDust');
    const [c] = await ctx.engine.createWallets(1, 'child');
    await ctx.engine.idle();
    expect(ctx.store.getWallet(c.id)!.failedStep).toBe('dust_pending');
    // lần đồng bộ đầu ở funding (1) + ép buộc khi bị loại (1); các lần đồng bộ khác bị điều tiết
    expect(savesOf(ctx, c.id)).toBe(2);
    await ctx.engine.closeAll();
  });
});
