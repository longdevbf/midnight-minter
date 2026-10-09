import { randomUUID } from 'node:crypto';
import type { EventEmitter } from 'node:events';
import type { ChainWallet, Chain } from '../chain/types';
import { deriveKeys, newMnemonic } from '../chain/keys';
import type { NetworkConfig } from '../config/networks';
import type { Store } from '../db/store';
import type { Vault } from '../lib/vault';
import type { TokenRecord, WalletKind, WalletRecord, WalletStatus } from '../types';
import { NIGHT_DECIMALS, formatUnits } from '../../../shared/units';
import { JobQueue, type Job } from './job-queue';

export interface EngineDeps {
  store: Store;
  vault: Vault;
  chain: Chain;
  network: NetworkConfig;
  bus: EventEmitter;
  fundAmount: bigint;
  waitFundMs?: number;
  /** Tối đa chờ cho mỗi lệnh gọi chuỗi có thể treo mãi (finalization, findDeployedContract). Mặc định 30 phút. */
  chainCallTimeoutMs?: number;
}

type WalletStep = 'funding' | 'syncing' | 'dust_pending';
const STEPS: WalletStep[] = ['funding', 'syncing', 'dust_pending'];
const MAX_OPEN = 3;

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const night = (v: bigint) => `${formatUnits(v, NIGHT_DECIMALS)} tNIGHT`;

const DEFAULT_CHAIN_CALL_TIMEOUT_MS = 30 * 60_000;

class ChainTimeoutError extends Error {}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${Math.round(ms / 1000)} giây`;
  return `${Math.round(ms / 60_000)} phút`;
}

/** Từ chối khi `promise` không xong sau `ms`; luôn dọn timer khi promise đã settle. */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new ChainTimeoutError(`${label} quá thời gian chờ (${formatDuration(ms)}). Bấm Thử lại để tiếp tục.`)),
      ms,
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export class Engine {
  private readonly queue: JobQueue;
  private readonly open = new Map<string, ChainWallet>();

  constructor(private readonly d: EngineDeps) {
    this.queue = new JobQueue((job) => this.run(job));
  }

  idle() {
    return this.queue.idle();
  }

  async closeAll() {
    await this.queue.idle();
    for (const [id, w] of this.open) {
      await w.close().catch(() => undefined);
      this.open.delete(id);
    }
  }

  /** Tạo ví mới (sinh seedphrase, mã hóa, lưu) rồi đưa vào hàng đợi. */
  async createWallets(count: number, kind: WalletKind, labelPrefix = 'Ví'): Promise<WalletRecord[]> {
    if (kind === 'treasury' && this.d.store.getTreasury()) throw new Error('Đã có ví tổng');
    const existing = this.d.store.listWallets().filter((w) => w.kind === 'child').length;
    const created: WalletRecord[] = [];
    for (let i = 0; i < count; i++) {
      const mnemonic = newMnemonic();
      const keys = await deriveKeys(mnemonic, this.d.network.networkId);
      const record: WalletRecord = {
        id: randomUUID(),
        label: kind === 'treasury' ? 'Ví tổng' : `${labelPrefix} ${existing + i + 1}`,
        kind,
        network: this.d.network.name,
        unshieldedAddress: keys.unshieldedAddress,
        encryptedMnemonic: this.d.vault.encrypt(mnemonic),
        status: 'created',
        failedStep: null,
        message: null,
        nightBalance: '0',
        dustBalance: '0',
        createdAt: Date.now(),
      };
      this.d.store.insertWallet(record);
      created.push(record);
      this.emit('wallet', record.id);
      this.queue.enqueue({ type: 'wallet', id: record.id });
    }
    return created;
  }

  retryWallet(id: string) {
    this.queue.enqueue({ type: 'wallet', id });
  }

  refreshWallet(id: string) {
    this.queue.enqueue({ type: 'refresh', id });
  }

  enqueueToken(id: string) {
    this.queue.enqueue({ type: 'token', id });
  }

  /** Chạy tiếp việc dở dang sau khi mở lại app. */
  resume() {
    for (const w of this.d.store.listIncompleteWallets()) this.queue.enqueue({ type: 'wallet', id: w.id });
    for (const t of this.d.store.listIncompleteTokens()) this.queue.enqueue({ type: 'token', id: t.id });
  }

  /** Gọi định kỳ: ví đang chờ (faucet / ví tổng) được kiểm tra lại. */
  pollWaiting() {
    for (const w of this.d.store.listWallets()) {
      if (w.status === 'funding' && w.failedStep === null) this.queue.enqueue({ type: 'wallet', id: w.id });
    }
  }

  // ---------------------------------------------------------------- nội bộ

  private emit(kind: 'wallet' | 'token', id: string) {
    this.d.bus.emit('change', { kind, id });
  }

  private patchWallet(id: string, patch: Partial<WalletRecord>) {
    const w = this.d.store.updateWallet(id, patch);
    this.emit('wallet', id);
    return w;
  }

  private patchToken(id: string, patch: Partial<TokenRecord>) {
    const t = this.d.store.updateToken(id, patch);
    this.emit('token', id);
    return t;
  }

  private saveBalances(id: string, b: { night: bigint; dust: bigint }) {
    this.patchWallet(id, { nightBalance: b.night.toString(), dustBalance: b.dust.toString() });
  }

  /**
   * Bọc một lệnh gọi chuỗi có thể chờ mãi bằng timeout. Khi quá hạn, ví đang dùng bị đóng và bỏ khỏi
   * bộ nhớ đệm để lần thử lại mở ví mới (ví cũ có thể đang kẹt giữa chừng).
   */
  private async guarded<T>(walletId: string, label: string, promise: Promise<T>): Promise<T> {
    try {
      return await withTimeout(promise, this.d.chainCallTimeoutMs ?? DEFAULT_CHAIN_CALL_TIMEOUT_MS, label);
    } catch (e) {
      if (e instanceof ChainTimeoutError) {
        const stuck = this.open.get(walletId);
        this.open.delete(walletId);
        if (stuck) await stuck.close().catch(() => undefined);
      }
      throw e;
    }
  }

  private async getOpen(w: WalletRecord): Promise<ChainWallet> {
    const cached = this.open.get(w.id);
    if (cached) return cached;
    const opened = await this.d.chain.open(this.d.network, this.d.vault.decrypt(w.encryptedMnemonic));
    this.open.set(w.id, opened);
    await this.trim();
    return opened;
  }

  private async trim() {
    while (this.open.size > MAX_OPEN) {
      const victim = [...this.open.keys()].find((id) => this.d.store.getWallet(id)?.kind !== 'treasury');
      if (!victim) return;
      const w = this.open.get(victim) as ChainWallet;
      this.open.delete(victim);
      await w.close().catch(() => undefined);
    }
  }

  private async run(job: Job) {
    if (job.type === 'wallet') return this.runWallet(job.id);
    if (job.type === 'token') return this.runToken(job.id);
    return this.runRefresh(job.id);
  }

  private async runWallet(id: string) {
    const w = this.d.store.getWallet(id);
    if (!w || w.status === 'ready') return;
    const from: WalletStatus = w.status === 'failed' ? ((w.failedStep as WalletStatus) ?? 'funding') : w.status;
    const start = Math.max(0, STEPS.indexOf(from as WalletStep));

    for (let i = start; i < STEPS.length; i++) {
      const step = STEPS[i];
      this.patchWallet(id, { status: step, failedStep: null, message: null });
      try {
        const result = await this.runStep(step, this.d.store.getWallet(id) as WalletRecord);
        if (result === 'wait') return; // giữ nguyên status, message đã được ghi
      } catch (e) {
        this.patchWallet(id, { status: 'failed', failedStep: step, message: errMsg(e) });
        return;
      }
    }
    try {
      const cw = await this.getOpen(this.d.store.getWallet(id) as WalletRecord);
      this.saveBalances(id, await cw.balances(false));
    } catch {
      /* số dư sẽ được cập nhật ở lần làm mới sau */
    }
    this.patchWallet(id, { status: 'ready', failedStep: null, message: null });
  }

  private async runStep(step: WalletStep, w: WalletRecord): Promise<'ok' | 'wait'> {
    if (step === 'funding') return this.stepFunding(w);
    const cw = await this.getOpen(w);
    if (step === 'syncing') {
      this.saveBalances(w.id, await cw.balances(true));
      return 'ok';
    }
    await this.guarded(w.id, 'Đăng ký DUST', cw.ensureDust());
    this.saveBalances(w.id, await cw.balances(true));
    return 'ok';
  }

  private async stepFunding(w: WalletRecord): Promise<'ok' | 'wait'> {
    const cw = await this.getOpen(w);
    const mine = await cw.balances(true);
    this.saveBalances(w.id, mine);

    if (w.kind === 'treasury') {
      if (mine.night > 0n) return 'ok';
      this.patchWallet(w.id, {
        message: `Chờ tNIGHT từ faucet. Xin tại ${this.d.network.faucetUrl} cho địa chỉ ${w.unshieldedAddress}`,
      });
      return 'wait';
    }

    if (mine.night >= this.d.fundAmount) return 'ok';
    const treasury = this.d.store.getTreasury();
    if (!treasury || treasury.status !== 'ready') {
      this.patchWallet(w.id, { message: 'Chờ ví tổng sẵn sàng (cần có tNIGHT và DUST) để cấp tNIGHT cho ví này' });
      return 'wait';
    }
    const tw = await this.getOpen(treasury);
    const tb = await tw.balances(true);
    this.saveBalances(treasury.id, tb);
    if (tb.night < this.d.fundAmount) {
      throw new Error(
        `Ví tổng không đủ tNIGHT (còn ${night(tb.night)}, cần ${night(this.d.fundAmount)}). ` +
          'Xin thêm tNIGHT từ faucet cho ví tổng rồi bấm Thử lại.',
      );
    }
    await this.guarded(treasury.id, 'Chuyển tNIGHT', tw.transferNight(w.unshieldedAddress, this.d.fundAmount));
    const arrived = await cw.waitNight(this.d.fundAmount, this.d.waitFundMs ?? 10 * 60_000);
    if (!arrived) throw new Error('Đã chuyển tNIGHT nhưng ví chưa nhận được sau 10 phút. Bấm Thử lại để kiểm tra tiếp.');
    this.saveBalances(w.id, await cw.balances(true));
    return 'ok';
  }

  private async runRefresh(id: string) {
    const w = this.d.store.getWallet(id);
    if (!w) return;
    try {
      const cw = await this.getOpen(w);
      this.saveBalances(id, await cw.balances(true));
    } catch (e) {
      this.patchWallet(id, { message: `Không làm mới được số dư: ${errMsg(e)}` });
    }
  }

  private async runToken(id: string) {
    let t = this.d.store.getToken(id);
    if (!t || t.status === 'done') return;
    const w = this.d.store.getWallet(t.walletId);
    if (!w || w.status !== 'ready') {
      this.patchToken(id, { status: 'failed', failedStep: 'deploying', message: 'Ví chưa sẵn sàng (cần có DUST). Đợi ví về trạng thái Sẵn sàng rồi thử lại.' });
      return;
    }
    let step: 'deploying' | 'minting' = 'deploying';
    try {
      const cw = await this.getOpen(w);
      const b = await cw.balances(true);
      this.saveBalances(w.id, b);
      if (b.dust <= 0n) throw new Error('Ví chưa có DUST để trả phí giao dịch');
      const ownerSecret = Buffer.from(this.d.vault.decrypt(t.encryptedOwnerSecret), 'hex');

      if (!t.contractAddress) {
        t = this.patchToken(id, { status: 'deploying', failedStep: null, message: null });
        const r = await this.guarded(
          w.id,
          'Deploy contract',
          cw.deployToken({
            ownerSecret,
            name: t.name,
            symbol: t.symbol,
            decimals: t.decimals,
            imageUri: t.imageUri,
            imageSha256Hex: t.imageSha256,
          }),
        );
        t = this.patchToken(id, { contractAddress: r.contractAddress, deployTxId: r.txId });
      }

      step = 'minting';
      if (!t.mintTxId) {
        this.patchToken(id, { status: 'minting', failedStep: null, message: null });
        const r = await this.guarded(
          w.id,
          'Mint token',
          cw.mintToken({
            contractAddress: t.contractAddress as string,
            ownerSecret,
            baseUnits: BigInt(t.baseUnits),
          }),
        );
        // r.txId có thể là chuỗi đặc biệt "already-minted" (đường idempotent của chain thật: token đã mint từ trước).
        // Lưu nguyên giá trị; giao diện KHÔNG được hiển thị nó như một mã giao dịch (tx hash).
        t = this.patchToken(id, { mintTxId: r.txId, tokenColor: r.tokenColor });
      }
      this.patchToken(id, { status: 'done', failedStep: null, message: null });
      this.saveBalances(w.id, await cw.balances(false));
    } catch (e) {
      this.patchToken(id, { status: 'failed', failedStep: step, message: errMsg(e) });
    }
  }
}
