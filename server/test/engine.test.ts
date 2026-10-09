import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Engine, type EngineDeps } from '../src/engine/engine';
import { openStore, type Store } from '../src/db/store';
import { createVault, makeSalt } from '../src/lib/vault';
import { getNetworkConfig } from '../src/config/networks';
import { makeFakeChain } from './fake-chain';
import type { TokenRecord } from '../src/types';

const FUND = 100_000_000n;
const network = getNetworkConfig('preview', {});

// Engine ghi log trạng thái snapshot (console.log): chặn để đầu ra test sạch.
let silenceLog: { mockRestore(): void } | undefined;
beforeEach(() => {
  silenceLog = vi.spyOn(console, 'log').mockImplementation(() => undefined);
});
afterEach(() => {
  silenceLog?.mockRestore();
});

type SetupOpts = Partial<Omit<EngineDeps, 'store' | 'vault' | 'chain' | 'network' | 'bus' | 'fundAmount'>>;

function setup(opts: SetupOpts = {}) {
  const store = openStore(':memory:');
  const vault = createVault('mat-khau-chu-123', makeSalt());
  const fake = makeFakeChain();
  const bus = new EventEmitter();
  const events: Array<{ kind: string; id: string }> = [];
  bus.on('change', (e) => events.push(e));
  const engine = new Engine({ store, vault, chain: fake.chain, network, bus, fundAmount: FUND, waitFundMs: 10, ...opts });
  return { store, vault, fake, engine, events, bus };
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
    ctx = setup({ autoRetryDelayMs: 1 });
    await readyTreasury(ctx);
    // đặt trước khi tạo vì job chạy ngay; 3 lần = lần đầu + 2 lần tự thử lại (F9.2) đều lỗi
    ctx.fake.state.failCount.set('ensureDust', 3);
    const [c] = await ctx.engine.createWallets(1, 'child');
    await vi.waitFor(() => expect(ctx.store.getWallet(c.id)!.status).toBe('failed'), { timeout: 2000, interval: 5 });
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

  it('maxOpenWallets: 2 — đóng bớt ví cũ khi mở quá 2 ví cùng lúc, giữ ví tổng (R2)', async () => {
    ctx = setup({ maxOpenWallets: 2 });
    const tid = await readyTreasury(ctx);
    const children = await ctx.engine.createWallets(4, 'child');
    await ctx.engine.idle();
    for (const c of children) expect(ctx.store.getWallet(c.id)!.status).toBe('ready');
    expect(ctx.fake.state.closed).toBeGreaterThan(0);
    expect(ctx.fake.state.opened - ctx.fake.state.closed).toBeLessThanOrEqual(2);
    expect(ctx.fake.state.closedMnemonics).not.toContain(mnemonicOf(ctx, tid)); // ví tổng không bị đóng
    expect(ctx.store.getTreasury()!.status).toBe('ready');
  });

  it('mặc định giữ tới 6 ví mở: ví tổng + 4 ví con không đóng ví nào (R2)', async () => {
    await readyTreasury(ctx);
    await ctx.engine.createWallets(4, 'child');
    await ctx.engine.idle();
    expect(ctx.fake.state.opened).toBe(5);
    expect(ctx.fake.state.closed).toBe(0);
    await ctx.engine.createWallets(2, 'child');
    await ctx.engine.idle();
    expect(ctx.fake.state.opened - ctx.fake.state.closed).toBe(6);
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

  it('deploy bị node từ chối (submission error): đổi khoá chủ mới và thử lại một lần', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    ctx.store.insertToken(newToken());
    const before = ctx.store.getToken('tok1')!.encryptedOwnerSecret;
    ctx.fake.state.failMessage = 'Transaction submission error';
    ctx.fake.state.failOnce.add('deploy');
    ctx.engine.enqueueToken('tok1');
    await ctx.engine.idle();
    const t = ctx.store.getToken('tok1')!;
    expect(t.status).toBe('done');
    expect(t.encryptedOwnerSecret).not.toBe(before);
    expect(ctx.fake.state.calls.filter((c) => c.startsWith('deploy:'))).toHaveLength(2);
    warn.mockRestore();
  });

  it('deploy lỗi khác submission error: không đổi khoá', async () => {
    ctx.store.insertToken(newToken());
    const before = ctx.store.getToken('tok1')!.encryptedOwnerSecret;
    ctx.fake.state.failOnce.add('deploy');
    ctx.engine.enqueueToken('tok1');
    await ctx.engine.idle();
    expect(ctx.store.getToken('tok1')!.encryptedOwnerSecret).toBe(before);
    expect(ctx.fake.state.calls.filter((c) => c.startsWith('deploy:'))).toHaveLength(1);
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
    const ctx = setup({ chainCallTimeoutMs: 30, dustTimeoutMs: 30 });
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

// ------------------------------------------------------------------ vòng sửa 1

const fundingKey = (id: string) => `funding_sent:${id}`;
const transferCount = (ctx: ReturnType<typeof setup>) => ctx.fake.state.calls.filter((c) => c.startsWith('transfer:')).length;

function insertTok(ctx: ReturnType<typeof setup>, walletId: string, over: Partial<TokenRecord> = {}) {
  ctx.store.insertToken({
    id: 'tok1', walletId, name: 'Papa', symbol: 'PAPA', decimals: 6, amountWhole: '10', baseUnits: '10000000',
    imageUri: 'ipfs://cid', imageGatewayUrl: 'https://gw/ipfs/cid', imageSha256: 'ab'.repeat(32),
    encryptedOwnerSecret: ctx.vault.encrypt('cd'.repeat(32)),
    contractAddress: null, tokenColor: null, deployTxId: null, mintTxId: null,
    status: 'queued', failedStep: null, message: null, createdAt: Date.now(), ...over,
  });
}

describe('Engine — hai lần bấm tạo ví tổng', () => {
  it('chỉ một ví tổng được tạo khi gọi đồng thời', async () => {
    const ctx = setup();
    const results = await Promise.allSettled([
      ctx.engine.createWallets(1, 'treasury'),
      ctx.engine.createWallets(1, 'treasury'),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(rejected).toHaveLength(1);
    expect(String(rejected[0].reason.message)).toMatch(/Đã có ví tổng/);
    expect(ctx.store.listWallets().filter((w) => w.kind === 'treasury')).toHaveLength(1);
    await ctx.engine.idle();
  });
});

describe('Engine — không chuyển tNIGHT hai lần', () => {
  it('(a) giao dịch đã gửi nhưng chưa tới: retry chỉ chờ, không chuyển lại; tới rồi thì ready và xoá dấu', async () => {
    const ctx = setup();
    await readyTreasury(ctx);
    ctx.fake.state.holdCredit = true;
    const [c] = await ctx.engine.createWallets(1, 'child');
    await ctx.engine.idle();
    const failed = ctx.store.getWallet(c.id)!;
    expect(failed.status).toBe('failed');
    expect(failed.failedStep).toBe('funding');
    expect(failed.message).toMatch(/không chuyển lại/);
    expect(transferCount(ctx)).toBe(1);
    expect(ctx.store.getMeta(fundingKey(c.id))).toBeTruthy();

    ctx.engine.retryWallet(c.id);
    await ctx.engine.idle();
    const waiting = ctx.store.getWallet(c.id)!;
    expect(waiting.status).toBe('funding');
    expect(waiting.failedStep).toBeNull();
    expect(waiting.message).toMatch(/chưa được xác nhận/);
    expect(transferCount(ctx)).toBe(1);

    ctx.fake.releaseCredits();
    ctx.engine.pollWaiting();
    await ctx.engine.idle();
    expect(ctx.store.getWallet(c.id)!.status).toBe('ready');
    expect(transferCount(ctx)).toBe(1);
    expect(ctx.store.getMeta(fundingKey(c.id))).toBe('');
  });

  it('(b) dấu cũ nhưng ví tổng chưa bị trừ (giao dịch chưa từng tới chuỗi): chuyển đúng một lần', async () => {
    const ctx = setup();
    const tid = await readyTreasury(ctx);
    const [c] = await ctx.engine.createWallets(1, 'child');
    await ctx.engine.idle();
    expect(ctx.store.getWallet(c.id)!.status).toBe('ready');
    // Giả lập app sập giữa lúc gửi: ví con về 0, dấu ghi số dư ví tổng HIỆN TẠI (chưa bị trừ thêm).
    ctx.fake.state.calls.length = 0;
    ctx.fake.state.night.set(mnemonicOf(ctx, c.id), 0n);
    ctx.store.updateWallet(c.id, { status: 'failed', failedStep: 'funding', message: 'x' });
    const treasuryNight = ctx.fake.state.night.get(mnemonicOf(ctx, tid))!;
    ctx.store.setMeta(fundingKey(c.id), JSON.stringify({ treasuryBefore: treasuryNight.toString(), at: Date.now() }));
    ctx.engine.retryWallet(c.id);
    await ctx.engine.idle();
    expect(transferCount(ctx)).toBe(1);
    expect(ctx.store.getWallet(c.id)!.status).toBe('ready');
    expect(ctx.store.getMeta(fundingKey(c.id))).toBe('');
  });

  it('(c) transferNight treo sau khi ví tổng đã bị trừ: retry không chuyển lại', async () => {
    const ctx = setup({ chainCallTimeoutMs: 30 });
    await readyTreasury(ctx);
    ctx.fake.state.hang.add('transferAfter');
    const [c] = await ctx.engine.createWallets(1, 'child');
    await ctx.engine.idle();
    const failed = ctx.store.getWallet(c.id)!;
    expect(failed.status).toBe('failed');
    expect(failed.failedStep).toBe('funding');
    expect(failed.message).toMatch(/quá thời gian chờ/);
    ctx.fake.state.hang.delete('transferAfter');
    ctx.engine.retryWallet(c.id);
    await ctx.engine.idle();
    expect(ctx.store.getWallet(c.id)!.status).toBe('ready');
    expect(transferCount(ctx)).toBe(1);
  });
});

describe('Engine — đồng bộ ví quá thời gian', () => {
  it('balances(true) treo ở bước syncing: failed(syncing) quá thời gian, thử lại thành công', async () => {
    // 150 ms (không phải 30): syncTimeoutMs cũng giới hạn open() mà open giả còn derive khóa, máy bận có thể quá 30 ms.
    const ctx = setup({ syncTimeoutMs: 150 });
    await readyTreasury(ctx);
    let armed = true;
    ctx.bus.on('change', () => {
      const child = ctx.store.listWallets().find((w) => w.kind === 'child');
      if (armed && child?.status === 'syncing') {
        armed = false;
        ctx.fake.state.hang.add('balances');
      }
    });
    const [c] = await ctx.engine.createWallets(1, 'child');
    await ctx.engine.idle();
    const failed = ctx.store.getWallet(c.id)!;
    expect(failed.status).toBe('failed');
    expect(failed.failedStep).toBe('syncing');
    expect(failed.message).toMatch(/quá thời gian chờ/);
    expect(failed.message).not.toMatch(/NaN/);
    ctx.fake.state.hang.delete('balances');
    ctx.engine.retryWallet(c.id);
    await ctx.engine.idle();
    expect(ctx.store.getWallet(c.id)!.status).toBe('ready');
  });

  it('timeout vô hạn/rất lớn bị kẹp về giới hạn setTimeout (không bắn sau 1 ms)', async () => {
    const ctx = setup({ chainCallTimeoutMs: Infinity, syncTimeoutMs: Number.MAX_SAFE_INTEGER });
    const real = globalThis.setTimeout;
    const delays: unknown[] = [];
    const spy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void, ms?: number, ...a: unknown[]) => {
      delays.push(ms);
      return real(fn, ms, ...a);
    }) as typeof setTimeout);
    try {
      await readyTreasury(ctx);
      const [c] = await ctx.engine.createWallets(1, 'child');
      await ctx.engine.idle();
      expect(ctx.store.getWallet(c.id)!.status).toBe('ready');
    } finally {
      spy.mockRestore();
    }
    const big = delays.filter((d) => typeof d === 'number' && d > 1_000_000);
    expect(big.length).toBeGreaterThan(0); // có timer dài thật sự được đặt
    expect(delays.every((d) => d === undefined || (typeof d === 'number' && d <= 2_147_483_647))).toBe(true);
  });
});

describe('Engine — token: sửa lỗi nhỏ', () => {
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

  it('đọc số dư cuối lỗi không làm token đã done thành failed', async () => {
    insertTok(ctx, walletId);
    ctx.fake.state.failOnce.add('balancesFinal');
    ctx.engine.enqueueToken('tok1');
    await ctx.engine.idle();
    expect(ctx.fake.state.failOnce.has('balancesFinal')).toBe(false); // lần đọc cuối đã thực sự ném lỗi
    expect(ctx.store.getToken('tok1')!.status).toBe('done');
  });

  it('hết DUST khi đã có contract: failedStep là minting', async () => {
    insertTok(ctx, walletId, { contractAddress: 'contract-x'.padEnd(64, '0'), deployTxId: 'tx', status: 'failed', failedStep: 'minting' });
    ctx.fake.state.dust.set(mnemonicOf(ctx, walletId), 0n);
    ctx.engine.enqueueToken('tok1');
    await ctx.engine.idle();
    const t = ctx.store.getToken('tok1')!;
    expect(t.status).toBe('failed');
    expect(t.failedStep).toBe('minting');
    expect(t.message).toMatch(/DUST/);
  });

  it('ví chưa sẵn sàng: đã có contract thì failedStep minting, chưa có thì deploying', async () => {
    ctx.store.updateWallet(walletId, { status: 'funding' });
    insertTok(ctx, walletId, { id: 'a', contractAddress: 'contract-x'.padEnd(64, '0') });
    insertTok(ctx, walletId, { id: 'b' });
    ctx.engine.enqueueToken('a');
    ctx.engine.enqueueToken('b');
    await ctx.engine.idle();
    expect(ctx.store.getToken('a')!.failedStep).toBe('minting');
    expect(ctx.store.getToken('b')!.failedStep).toBe('deploying');
  });

  it('thông báo timeout của deploy nói rõ giao dịch có thể vẫn xác nhận và Thử lại sẽ deploy contract mới (F11)', async () => {
    const c2 = setup({ chainCallTimeoutMs: 30 });
    await readyTreasury(c2);
    const [w] = await c2.engine.createWallets(1, 'child');
    await c2.engine.idle();
    insertTok(c2, w.id);
    c2.fake.state.hang.add('deploy');
    c2.engine.enqueueToken('tok1');
    await c2.engine.idle();
    expect(c2.store.getToken('tok1')!.message).toContain(
      'Giao dịch deploy có thể vẫn được xác nhận và tốn DUST; bấm Thử lại sẽ deploy một contract mới.',
    );
  });
});

// ------------------------------------------------------------------ vòng sửa cuối

describe('Engine — ví con không mở khi ví tổng chưa sẵn sàng (F2)', () => {
  it('ví con chờ ví tổng mà không mở/đồng bộ; pollWaiting không mở lại; ví tổng có tiền thì ví con chạy tới ready', async () => {
    const ctx = setup();
    const [t] = await ctx.engine.createWallets(1, 'treasury');
    const children = await ctx.engine.createWallets(4, 'child');
    await ctx.engine.idle();
    expect(ctx.fake.state.opened).toBe(1); // chỉ ví tổng
    for (const c of children) {
      const w = ctx.store.getWallet(c.id)!;
      expect(w.status).toBe('funding');
      expect(w.message).toMatch(/Chờ ví tổng sẵn sàng/);
    }

    ctx.engine.pollWaiting();
    await ctx.engine.idle();
    ctx.engine.pollWaiting();
    await ctx.engine.idle();
    expect(ctx.fake.state.opened).toBe(1);

    ctx.fake.state.night.set(mnemonicOf(ctx, t.id), 1_000_000_000n);
    ctx.engine.retryWallet(t.id);
    await ctx.engine.idle();
    expect(ctx.store.getWallet(t.id)!.status).toBe('ready');
    for (const c of children) expect(ctx.store.getWallet(c.id)!.status).toBe('ready');
  });

  it('pollWaiting: luôn kiểm tra lại ví tổng đang funding, chỉ đưa ví con funding vào hàng khi ví tổng ready', async () => {
    const ctx = setup();
    await ctx.engine.createWallets(1, 'treasury');
    await ctx.engine.idle();
    const before = ctx.fake.state.balanceCalls;
    ctx.engine.pollWaiting();
    await ctx.engine.idle();
    expect(ctx.fake.state.balanceCalls - before).toBe(1); // ví tổng được đọc lại số dư
  });
});

describe('Engine — mở ví quá thời gian không rò ví (F6)', () => {
  it('open xong sau khi đã quá thời gian: ví failed(syncing) quá thời gian chờ, ví mở muộn được đóng', async () => {
    const ctx = setup();
    await readyTreasury(ctx);
    const [c] = await ctx.engine.createWallets(1, 'child');
    await ctx.engine.idle();
    // Giả lập app khởi động lại khi ví con đang ở bước syncing: engine mới, chưa có ví nào mở sẵn.
    ctx.store.updateWallet(c.id, { status: 'failed', failedStep: 'syncing', message: 'x' });
    const engine2 = new Engine({
      store: ctx.store, vault: ctx.vault, chain: ctx.fake.chain, network, bus: ctx.bus, fundAmount: FUND, syncTimeoutMs: 30,
    });
    ctx.fake.state.openDelayMs = 100;
    const closedBefore = ctx.fake.state.closed;
    engine2.retryWallet(c.id);
    await engine2.idle();
    const w = ctx.store.getWallet(c.id)!;
    expect(w.status).toBe('failed');
    expect(w.failedStep).toBe('syncing');
    expect(w.message).toMatch(/quá thời gian chờ/);
    expect(ctx.fake.state.closed).toBe(closedBefore); // open chưa xong
    await new Promise((r) => setTimeout(r, 200));
    expect(ctx.fake.state.closed).toBe(closedBefore + 1); // ví mở muộn đã được đóng
    await engine2.closeAll();
    await ctx.engine.closeAll();
  });
});

describe('Engine — tự thử lại lỗi tạm ở bước syncing/dust_pending (F9.2)', () => {
  const dustCalls = (ctx: ReturnType<typeof setup>, id: string) =>
    ctx.fake.state.calls.filter((x) => x === `ensureDust:${mnemonicOf(ctx, id)}`).length;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const settle = async (ctx: ReturnType<typeof setup>, id: string, status: 'ready' | 'failed') => {
    await vi.waitFor(() => expect(ctx.store.getWallet(id)!.status).toBe(status), { timeout: 2000, interval: 5 });
    await ctx.engine.idle();
  };

  it('ensureDust lỗi một lần: tự thử lại đúng một lần rồi ready, xoá bộ đếm', async () => {
    const ctx = setup({ autoRetryDelayMs: 5 });
    await readyTreasury(ctx);
    ctx.fake.state.failOnce.add('ensureDust');
    const [c] = await ctx.engine.createWallets(1, 'child');
    await ctx.engine.idle();
    const pending = ctx.store.getWallet(c.id)!;
    expect(pending.status).toBe('dust_pending');
    expect(pending.failedStep).toBeNull();
    expect(pending.message).toMatch(/^Lỗi tạm thời, tự thử lại sau .+ \(lần 1\/2\)/);
    await settle(ctx, c.id, 'ready');
    expect(dustCalls(ctx, c.id)).toBe(2);
    expect(ctx.store.getMeta(`autoretry:${c.id}`) ?? '').toBe('');
    await ctx.engine.closeAll();
  });

  it('lỗi ở bước syncing cũng được tự thử lại', async () => {
    const ctx = setup({ autoRetryDelayMs: 5 });
    await readyTreasury(ctx);
    let armed = true;
    ctx.bus.on('change', () => {
      const child = ctx.store.listWallets().find((w) => w.kind === 'child');
      if (armed && child?.status === 'syncing') {
        armed = false;
        ctx.fake.state.failOnce.add('balances');
      }
    });
    const [c] = await ctx.engine.createWallets(1, 'child');
    await ctx.engine.idle();
    expect(ctx.store.getWallet(c.id)!.status).toBe('syncing');
    expect(ctx.store.getWallet(c.id)!.message).toMatch(/lần 1\/2/);
    await settle(ctx, c.id, 'ready');
    await ctx.engine.closeAll();
  });

  it('lỗi 3 lần liên tiếp: failed(dust_pending) sau đúng 2 lần tự thử lại; bấm Thử lại thì bộ đếm về 0', async () => {
    const ctx = setup({ autoRetryDelayMs: 5 });
    await readyTreasury(ctx);
    ctx.fake.state.failCount.set('ensureDust', 3);
    const [c] = await ctx.engine.createWallets(1, 'child');
    await ctx.engine.idle();
    await settle(ctx, c.id, 'failed');
    const w = ctx.store.getWallet(c.id)!;
    expect(w.failedStep).toBe('dust_pending');
    expect(w.message).toMatch(/lỗi giả lập ở ensureDust/);
    expect(dustCalls(ctx, c.id)).toBe(3);
    await sleep(30);
    expect(dustCalls(ctx, c.id)).toBe(3); // không còn lần tự thử nào nữa

    // người dùng bấm Thử lại: lại được tự thử lại từ lần 1/2
    ctx.fake.state.failCount.set('ensureDust', 1);
    ctx.engine.retryWallet(c.id);
    await ctx.engine.idle();
    expect(ctx.store.getWallet(c.id)!.message).toMatch(/lần 1\/2/);
    await settle(ctx, c.id, 'ready');
    expect(dustCalls(ctx, c.id)).toBe(5);
    await ctx.engine.closeAll();
  });

  it('lỗi nghiệp vụ (quá thời gian chờ) không tự thử lại', async () => {
    const ctx = setup({ autoRetryDelayMs: 5, dustTimeoutMs: 30 });
    await readyTreasury(ctx);
    ctx.fake.state.hang.add('ensureDust');
    const [c] = await ctx.engine.createWallets(1, 'child');
    await ctx.engine.idle();
    expect(ctx.store.getWallet(c.id)!.status).toBe('failed');
    await sleep(40);
    await ctx.engine.idle();
    expect(ctx.store.getWallet(c.id)!.status).toBe('failed');
    expect(ctx.store.getWallet(c.id)!.failedStep).toBe('dust_pending');
    expect(dustCalls(ctx, c.id)).toBe(1);
    await ctx.engine.closeAll();
  });

  it('lỗi ở bước funding không tự thử lại', async () => {
    const ctx = setup({ autoRetryDelayMs: 5 });
    await readyTreasury(ctx);
    ctx.fake.state.failOnce.add('transfer');
    const [c] = await ctx.engine.createWallets(1, 'child');
    await ctx.engine.idle();
    await sleep(40);
    await ctx.engine.idle();
    const w = ctx.store.getWallet(c.id)!;
    expect(w.status).toBe('failed');
    expect(w.failedStep).toBe('funding');
    expect(transferCount(ctx)).toBe(1);
    await ctx.engine.closeAll();
  });

  it('closeAll() huỷ lần tự thử lại đang chờ (không còn timer treo)', async () => {
    const ctx = setup({ autoRetryDelayMs: 30 });
    await readyTreasury(ctx);
    ctx.fake.state.failOnce.add('ensureDust');
    const [c] = await ctx.engine.createWallets(1, 'child');
    await ctx.engine.idle();
    expect(ctx.store.getWallet(c.id)!.message).toMatch(/lần 1\/2/);
    await ctx.engine.closeAll();
    await sleep(80);
    await ctx.engine.idle();
    expect(dustCalls(ctx, c.id)).toBe(1);
    expect(ctx.store.getWallet(c.id)!.status).toBe('dust_pending'); // mở lại app thì resume() chạy tiếp
  });
});

describe('Engine — che khóa bí mật trong thông báo lỗi đã lưu (F4, phía Engine)', () => {
  const KEY = 'previewKeyAbc123SECRET';
  const redact = (s: string) => s.split(KEY).join('***');
  const leaky = `RPC-CORE: disconnected from wss://rpc.example/?project_id=${KEY}`;

  it('lỗi ở bước funding: message của ví có *** và không có khóa', async () => {
    const ctx = setup({ redact });
    await readyTreasury(ctx);
    ctx.fake.state.failMessage = leaky;
    ctx.fake.state.failOnce.add('transfer');
    const [c] = await ctx.engine.createWallets(1, 'child');
    await ctx.engine.idle();
    const w = ctx.store.getWallet(c.id)!;
    expect(w.status).toBe('failed');
    expect(w.message).toContain('***');
    expect(w.message).not.toContain(KEY);
  });

  it('lỗi tạm đang chờ tự thử lại: message cũng được che', async () => {
    const ctx = setup({ redact, autoRetryDelayMs: 60_000 });
    await readyTreasury(ctx);
    ctx.fake.state.failMessage = leaky;
    ctx.fake.state.failOnce.add('ensureDust');
    const [c] = await ctx.engine.createWallets(1, 'child');
    await ctx.engine.idle();
    const w = ctx.store.getWallet(c.id)!;
    expect(w.message).toMatch(/Lỗi tạm thời/);
    expect(w.message).toContain('***');
    expect(w.message).not.toContain(KEY);
    await ctx.engine.closeAll(); // huỷ hẹn giờ 60 s
  });

  it('làm mới số dư lỗi: message có *** và không có khóa', async () => {
    const ctx = setup({ redact });
    const tid = await readyTreasury(ctx);
    ctx.fake.state.failMessage = leaky;
    ctx.fake.state.failOnce.add('balances');
    ctx.engine.refreshWallet(tid);
    await ctx.engine.idle();
    const w = ctx.store.getWallet(tid)!;
    expect(w.message).toMatch(/Không làm mới được số dư/);
    expect(w.message).toContain('***');
    expect(w.message).not.toContain(KEY);
  });

  it('token failOnce với lỗi chứa khóa: message của token có *** và không có khóa', async () => {
    const ctx = setup({ redact });
    await readyTreasury(ctx);
    const [c] = await ctx.engine.createWallets(1, 'child');
    await ctx.engine.idle();
    insertTok(ctx, c.id);
    ctx.fake.state.failMessage = leaky;
    ctx.fake.state.failOnce.add('deploy');
    ctx.engine.enqueueToken('tok1');
    await ctx.engine.idle();
    const t = ctx.store.getToken('tok1')!;
    expect(t.status).toBe('failed');
    expect(t.message).toContain('***');
    expect(t.message).not.toContain(KEY);
  });

  it('không truyền redact: giữ nguyên thông báo (mặc định identity)', async () => {
    const ctx = setup();
    await readyTreasury(ctx);
    ctx.fake.state.failMessage = leaky;
    ctx.fake.state.failOnce.add('transfer');
    const [c] = await ctx.engine.createWallets(1, 'child');
    await ctx.engine.idle();
    expect(ctx.store.getWallet(c.id)!.message).toBe(leaky);
  });
});

describe('Engine — thời gian chờ riêng cho bước DUST (F3)', () => {
  it('ensureDust chậm hơn chainCallTimeoutMs nhưng trong dustTimeoutMs: ready, không đóng ví', async () => {
    const ctx = setup({ chainCallTimeoutMs: 30, dustTimeoutMs: 500 });
    await readyTreasury(ctx);
    ctx.fake.state.delayMs.set('ensureDust', 100);
    const closedBefore = ctx.fake.state.closed;
    const [c] = await ctx.engine.createWallets(1, 'child');
    await ctx.engine.idle();
    const w = ctx.store.getWallet(c.id)!;
    expect(w.message).toBeNull();
    expect(w.status).toBe('ready');
    expect(ctx.fake.state.closed).toBe(closedBefore);
  });

  it('ensureDust treo quá dustTimeoutMs: failed(dust_pending) quá thời gian chờ, ví bị đóng', async () => {
    const ctx = setup({ chainCallTimeoutMs: 10_000, dustTimeoutMs: 40 });
    await readyTreasury(ctx);
    ctx.fake.state.hang.add('ensureDust');
    const closedBefore = ctx.fake.state.closed;
    const [c] = await ctx.engine.createWallets(1, 'child');
    await ctx.engine.idle();
    const w = ctx.store.getWallet(c.id)!;
    expect(w.status).toBe('failed');
    expect(w.failedStep).toBe('dust_pending');
    expect(w.message).toMatch(/quá thời gian chờ/);
    expect(ctx.fake.state.closed).toBeGreaterThan(closedBefore);
  });
});
