import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it } from 'vitest';
import { Engine } from '../src/engine/engine';
import { openStore, type Store } from '../src/db/store';
import { createVault, makeSalt } from '../src/lib/vault';
import { getNetworkConfig } from '../src/config/networks';
import { makeFakeChain } from './fake-chain';
import type { TokenRecord } from '../src/types';

const FUND = 100_000_000n;
const network = getNetworkConfig('preview', {});

function setup(opts: { chainCallTimeoutMs?: number } = {}) {
  const store = openStore(':memory:');
  const vault = createVault('mat-khau-chu-123', makeSalt());
  const fake = makeFakeChain();
  const bus = new EventEmitter();
  const events: Array<{ kind: string; id: string }> = [];
  bus.on('change', (e) => events.push(e));
  const engine = new Engine({ store, vault, chain: fake.chain, network, bus, fundAmount: FUND, waitFundMs: 10, ...opts });
  return { store, vault, fake, engine, events };
}

const mnemonicOf = (ctx: ReturnType<typeof setup>, id: string) =>
  ctx.vault.decrypt(ctx.store.getWallet(id)!.encryptedMnemonic);

/**
 * Job của ví chạy ngay khi tạo. Phải chờ nó xong (idle) rồi mới "xin faucet" (đặt số dư),
 * nếu không lệnh retry sẽ bị coi là trùng với job đang chạy.
 */
async function readyTreasury(ctx: ReturnType<typeof setup>, night = 1_000_000_000n) {
  const [t] = await ctx.engine.createWallets(1, 'treasury');
  await ctx.engine.idle(); // dừng ở funding, chờ faucet
  ctx.fake.state.night.set(mnemonicOf(ctx, t.id), night);
  ctx.engine.retryWallet(t.id);
  await ctx.engine.idle();
  return t.id;
}

describe('Engine — ví', () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => { ctx = setup(); });

  it('tạo ví con: mnemonic được mã hóa, địa chỉ đúng mạng, nhãn tự đánh số', async () => {
    const ws = await ctx.engine.createWallets(2, 'child');
    expect(ws.map((w) => w.label)).toEqual(['Ví 1', 'Ví 2']);
    for (const w of ws) {
      expect(w.unshieldedAddress).toMatch(/^mn_addr_preview1/);
      expect(w.encryptedMnemonic.startsWith('v1:')).toBe(true);
      expect(ctx.vault.decrypt(w.encryptedMnemonic).split(' ')).toHaveLength(24);
    }
    await ctx.engine.idle();
  });

  it('chỉ cho phép một ví tổng', async () => {
    await ctx.engine.createWallets(1, 'treasury');
    await expect(ctx.engine.createWallets(1, 'treasury')).rejects.toThrow(/đã có ví tổng/i);
  });

  it('ví tổng chưa có tNIGHT: dừng ở funding với hướng dẫn xin faucet, không báo lỗi', async () => {
    const [t] = await ctx.engine.createWallets(1, 'treasury');
    await ctx.engine.idle();
    const w = ctx.store.getWallet(t.id)!;
    expect(w.status).toBe('funding');
    expect(w.failedStep).toBeNull();
    expect(w.message).toMatch(/faucet/i);
  });

  it('ví tổng nhận tNIGHT rồi chạy hết vòng đời tới ready', async () => {
    const id = await readyTreasury(ctx);
    const w = ctx.store.getWallet(id)!;
    expect(w.status).toBe('ready');
    expect(BigInt(w.nightBalance)).toBe(1_000_000_000n);
    expect(BigInt(w.dustBalance)).toBeGreaterThan(0n);
  });

  it('ví con: ví tổng chuyển tNIGHT, sinh DUST, ready', async () => {
    const tid = await readyTreasury(ctx);
    const [c] = await ctx.engine.createWallets(1, 'child');
    await ctx.engine.idle();
    const w = ctx.store.getWallet(c.id)!;
    expect(w.status).toBe('ready');
    expect(BigInt(w.nightBalance)).toBe(FUND);
    expect(ctx.fake.state.calls.some((x) => x.includes('transfer:') && x.endsWith(`:${FUND}`))).toBe(true);
    expect(ctx.store.getWallet(tid)!.status).toBe('ready');
  });

  it('ví con khi chưa có ví tổng: chờ, không lỗi', async () => {
    const [c] = await ctx.engine.createWallets(1, 'child');
    await ctx.engine.idle();
    const w = ctx.store.getWallet(c.id)!;
    expect(w.status).toBe('funding');
    expect(w.message).toMatch(/ví tổng/i);
  });

  it('ví tổng không đủ tNIGHT: ví con failed(funding) với số cụ thể, thử lại được', async () => {
    await readyTreasury(ctx, 50_000_000n);
    const [c] = await ctx.engine.createWallets(1, 'child');
    await ctx.engine.idle();
    const failed = ctx.store.getWallet(c.id)!;
    expect(failed.status).toBe('failed');
    expect(failed.failedStep).toBe('funding');
    expect(failed.message).toMatch(/không đủ tNIGHT/);
    expect(failed.message).toContain('50');
    expect(failed.message).toContain('100');
    // xin thêm faucet rồi thử lại
    const t = ctx.store.getTreasury()!;
    ctx.fake.state.night.set(ctx.vault.decrypt(t.encryptedMnemonic), 500_000_000n);
    ctx.engine.retryWallet(c.id);
    await ctx.engine.idle();
    expect(ctx.store.getWallet(c.id)!.status).toBe('ready');
  });

  it('lỗi ở bước DUST: failed(dust_pending), retry chạy lại đúng bước đó và không chuyển tiền lần nữa', async () => {
    await readyTreasury(ctx);
    ctx.fake.state.failOnce.add('ensureDust'); // đặt trước khi tạo vì job chạy ngay
    const [c] = await ctx.engine.createWallets(1, 'child');
    await ctx.engine.idle();
    expect(ctx.store.getWallet(c.id)!.failedStep).toBe('dust_pending');
    const transfersBefore = ctx.fake.state.calls.filter((x) => x.startsWith('transfer:')).length;
    ctx.engine.retryWallet(c.id);
    await ctx.engine.idle();
    expect(ctx.store.getWallet(c.id)!.status).toBe('ready');
    expect(ctx.fake.state.calls.filter((x) => x.startsWith('transfer:')).length).toBe(transfersBefore);
  });

  it('bấm thử lại hai lần liên tiếp chỉ tạo một job', async () => {
    const [t] = await ctx.engine.createWallets(1, 'treasury');
    await ctx.engine.idle();
    const before = ctx.fake.state.balanceCalls;
    ctx.engine.retryWallet(t.id);
    ctx.engine.retryWallet(t.id);
    await ctx.engine.idle();
    expect(ctx.fake.state.balanceCalls - before).toBe(1); // mỗi lần chạy ví tổng đọc số dư đúng một lần
  });

  it('phát sự kiện change cho giao diện', async () => {
    await ctx.engine.createWallets(1, 'treasury');
    await ctx.engine.idle();
    expect(ctx.events.some((e) => e.kind === 'wallet')).toBe(true);
  });

  it('đóng bớt ví cũ khi mở quá 3 ví cùng lúc, giữ ví tổng', async () => {
    await readyTreasury(ctx);
    await ctx.engine.createWallets(4, 'child');
    await ctx.engine.idle();
    expect(ctx.fake.state.closed).toBeGreaterThan(0);
    expect(ctx.store.getTreasury()!.status).toBe('ready');
  });
});

describe('Engine — mint', () => {
  let ctx: ReturnType<typeof setup>;
  let walletId: string;
  beforeEach(async () => {
    ctx = setup();
    await readyTreasury(ctx);
    const [c] = await ctx.engine.createWallets(1, 'child');
    await ctx.engine.idle();
    expect(ctx.store.getWallet(c.id)!.status).toBe('ready');
    walletId = c.id;
  });

  const newToken = (over: Partial<TokenRecord> = {}): TokenRecord => ({
    id: 'tok1', walletId, name: 'Papa', symbol: 'PAPA', decimals: 6, amountWhole: '10', baseUnits: '10000000',
    imageUri: 'ipfs://cid', imageGatewayUrl: 'https://gw/ipfs/cid', imageSha256: 'ab'.repeat(32),
    encryptedOwnerSecret: ctx.vault.encrypt('cd'.repeat(32)),
    contractAddress: null, tokenColor: null, deployTxId: null, mintTxId: null,
    status: 'queued', failedStep: null, message: null, createdAt: Date.now(), ...over,
  });

  it('deploy rồi mint, lưu địa chỉ contract và màu token', async () => {
    ctx.store.insertToken(newToken());
    ctx.engine.enqueueToken('tok1');
    await ctx.engine.idle();
    const t = ctx.store.getToken('tok1')!;
    expect(t.status).toBe('done');
    expect(t.contractAddress).toMatch(/^contract-/);
    expect(t.tokenColor).toMatch(/^color-/);
    expect(t.deployTxId).toBeTruthy();
    expect(t.mintTxId).toBeTruthy();
  });

  it('mint lỗi: failed(minting), thử lại KHÔNG deploy lần hai', async () => {
    ctx.store.insertToken(newToken());
    ctx.fake.state.failOnce.add('mint');
    ctx.engine.enqueueToken('tok1');
    await ctx.engine.idle();
    const failed = ctx.store.getToken('tok1')!;
    expect(failed.status).toBe('failed');
    expect(failed.failedStep).toBe('minting');
    const addr = failed.contractAddress;
    expect(addr).toBeTruthy();
    const deploysBefore = ctx.fake.state.calls.filter((c) => c.startsWith('deploy:')).length;
    ctx.engine.enqueueToken('tok1');
    await ctx.engine.idle();
    expect(ctx.store.getToken('tok1')!.status).toBe('done');
    expect(ctx.store.getToken('tok1')!.contractAddress).toBe(addr);
    expect(ctx.fake.state.calls.filter((c) => c.startsWith('deploy:')).length).toBe(deploysBefore);
  });

  it('app tắt sau khi đã mint trên chuỗi nhưng chưa ghi DB: chạy lại không mint hai lần', async () => {
    ctx.store.insertToken(newToken());
    ctx.engine.enqueueToken('tok1');
    await ctx.engine.idle();
    // giả lập mất bản ghi mintTxId nhưng contract trên chuỗi đã mint
    ctx.store.updateToken('tok1', { status: 'minting', mintTxId: null, tokenColor: null });
    ctx.engine.enqueueToken('tok1');
    await ctx.engine.idle();
    const t = ctx.store.getToken('tok1')!;
    expect(t.status).toBe('done');
    expect(t.mintTxId).toBe('already-minted');
    expect(t.tokenColor).toMatch(/^color-/);
  });

  it('deploy lỗi: failed(deploying)', async () => {
    ctx.store.insertToken(newToken());
    ctx.fake.state.failOnce.add('deploy');
    ctx.engine.enqueueToken('tok1');
    await ctx.engine.idle();
    const t = ctx.store.getToken('tok1')!;
    expect(t.status).toBe('failed');
    expect(t.failedStep).toBe('deploying');
    expect(t.message).toMatch(/lỗi giả lập/);
  });

  it('ví chưa sẵn sàng: token failed với lý do rõ, không gọi chuỗi', async () => {
    const [c2] = await ctx.engine.createWallets(1, 'child');
    await ctx.engine.idle();
    ctx.store.updateWallet(c2.id, { status: 'funding' }); // giả lập ví đang cấp tiền
    ctx.store.insertToken(newToken({ id: 'tok2', walletId: c2.id }));
    ctx.engine.enqueueToken('tok2');
    await ctx.engine.idle();
    const t = ctx.store.getToken('tok2')!;
    expect(t.status).toBe('failed');
    expect(t.message).toMatch(/chưa sẵn sàng/);
    expect(ctx.fake.state.calls.some((c) => c.startsWith('deploy:'))).toBe(false);
  });

  it('ví hết DUST: báo rõ, không deploy', async () => {
    const w = ctx.store.getWallet(walletId)!;
    ctx.fake.state.dust.set(ctx.vault.decrypt(w.encryptedMnemonic), 0n);
    ctx.store.insertToken(newToken());
    ctx.engine.enqueueToken('tok1');
    await ctx.engine.idle();
    const t = ctx.store.getToken('tok1')!;
    expect(t.status).toBe('failed');
    expect(t.message).toMatch(/DUST/);
    expect(ctx.fake.state.calls.some((c) => c.startsWith('deploy:'))).toBe(false);
  });

  it('enqueueToken hai lần chỉ chạy một lần', async () => {
    ctx.store.insertToken(newToken());
    ctx.engine.enqueueToken('tok1');
    ctx.engine.enqueueToken('tok1');
    await ctx.engine.idle();
    expect(ctx.fake.state.calls.filter((c) => c.startsWith('deploy:')).length).toBe(1);
  });

  it('resume() đưa việc dở dang của lần chạy trước vào hàng đợi', async () => {
    ctx.store.insertToken(newToken({ status: 'minting' }));
    ctx.engine.resume();
    await ctx.engine.idle();
    expect(ctx.store.getToken('tok1')!.status).toBe('done');
  });
});

describe('Engine — quá thời gian chờ chuỗi', () => {
  it('ensureDust treo: ví failed(dust_pending) có thông báo quá thời gian, đóng ví cũ, thử lại thành công', async () => {
    const ctx = setup({ chainCallTimeoutMs: 30 });
    await readyTreasury(ctx);
    ctx.fake.state.hang.add('ensureDust');
    const [c] = await ctx.engine.createWallets(1, 'child');
    await ctx.engine.idle();
    const failed = ctx.store.getWallet(c.id)!;
    expect(failed.status).toBe('failed');
    expect(failed.failedStep).toBe('dust_pending');
    expect(failed.message).toMatch(/quá thời gian chờ/);
    expect(failed.message).not.toMatch(/NaN/);
    expect(ctx.fake.state.closed).toBeGreaterThan(0); // ví bị treo đã được đóng và loại khỏi bộ nhớ đệm

    const openedBefore = ctx.fake.state.opened;
    ctx.fake.state.hang.delete('ensureDust');
    ctx.engine.retryWallet(c.id);
    await ctx.engine.idle();
    expect(ctx.store.getWallet(c.id)!.status).toBe('ready');
    expect(ctx.fake.state.opened).toBeGreaterThan(openedBefore); // retry mở ví mới
  });

  it('transferNight treo: ví con failed(funding) quá thời gian, thử lại thành công', async () => {
    const ctx = setup({ chainCallTimeoutMs: 30 });
    await readyTreasury(ctx);
    ctx.fake.state.hang.add('transfer');
    const [c] = await ctx.engine.createWallets(1, 'child');
    await ctx.engine.idle();
    const failed = ctx.store.getWallet(c.id)!;
    expect(failed.status).toBe('failed');
    expect(failed.failedStep).toBe('funding');
    expect(failed.message).toMatch(/quá thời gian chờ/);
    ctx.fake.state.hang.delete('transfer');
    ctx.engine.retryWallet(c.id);
    await ctx.engine.idle();
    expect(ctx.store.getWallet(c.id)!.status).toBe('ready');
  });

  describe('token', () => {
    let ctx: ReturnType<typeof setup>;
    let walletId: string;
    beforeEach(async () => {
      ctx = setup({ chainCallTimeoutMs: 30 });
      await readyTreasury(ctx);
      const [c] = await ctx.engine.createWallets(1, 'child');
      await ctx.engine.idle();
      expect(ctx.store.getWallet(c.id)!.status).toBe('ready');
      walletId = c.id;
      ctx.store.insertToken({
        id: 'tok1', walletId, name: 'Papa', symbol: 'PAPA', decimals: 6, amountWhole: '10', baseUnits: '10000000',
        imageUri: 'ipfs://cid', imageGatewayUrl: 'https://gw/ipfs/cid', imageSha256: 'ab'.repeat(32),
        encryptedOwnerSecret: ctx.vault.encrypt('cd'.repeat(32)),
        contractAddress: null, tokenColor: null, deployTxId: null, mintTxId: null,
        status: 'queued', failedStep: null, message: null, createdAt: Date.now(),
      });
    });

    it('deploy treo: token failed(deploying) quá thời gian, thử lại (hết treo) thành công', async () => {
      ctx.fake.state.hang.add('deploy');
      ctx.engine.enqueueToken('tok1');
      await ctx.engine.idle();
      const failed = ctx.store.getToken('tok1')!;
      expect(failed.status).toBe('failed');
      expect(failed.failedStep).toBe('deploying');
      expect(failed.message).toMatch(/quá thời gian chờ/);
      expect(ctx.fake.state.closed).toBeGreaterThan(0);

      ctx.fake.state.hang.delete('deploy');
      ctx.engine.enqueueToken('tok1');
      await ctx.engine.idle();
      const t = ctx.store.getToken('tok1')!;
      expect(t.status).toBe('done');
      expect(t.contractAddress).toMatch(/^contract-/);
    });

    it('mint treo: token failed(minting) quá thời gian, thử lại không deploy lần hai', async () => {
      ctx.fake.state.hang.add('mint');
      ctx.engine.enqueueToken('tok1');
      await ctx.engine.idle();
      const failed = ctx.store.getToken('tok1')!;
      expect(failed.status).toBe('failed');
      expect(failed.failedStep).toBe('minting');
      expect(failed.message).toMatch(/quá thời gian chờ/);
      const deploys = ctx.fake.state.calls.filter((c) => c.startsWith('deploy:')).length;

      ctx.fake.state.hang.delete('mint');
      ctx.engine.enqueueToken('tok1');
      await ctx.engine.idle();
      expect(ctx.store.getToken('tok1')!.status).toBe('done');
      expect(ctx.fake.state.calls.filter((c) => c.startsWith('deploy:')).length).toBe(deploys);
    });
  });
});
