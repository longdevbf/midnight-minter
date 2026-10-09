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
  /** Tối đa chờ khi mở ví và đồng bộ số dư (balances(true)). Mặc định 60 phút. */
  syncTimeoutMs?: number;
  /**
   * Tối đa chờ riêng cho bước đăng ký/chờ DUST (ensureDust bên trong có thể chờ DUST sinh ra 20 phút rồi chờ
   * số dư DUST thêm 20 phút). Mặc định 45 phút. Quá hạn thì ví bị đóng như các lệnh gọi chuỗi khác.
   */
  dustTimeoutMs?: number;
}

type WalletStep = 'funding' | 'syncing' | 'dust_pending';
const STEPS: WalletStep[] = ['funding', 'syncing', 'dust_pending'];
const MAX_OPEN = 3;

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
/** Dấu bền vững trong bảng meta: đã gửi lệnh chuyển tNIGHT cho ví con này. */
const fundingKey = (walletId: string) => `funding_sent:${walletId}`;
const night = (v: bigint) => `${formatUnits(v, NIGHT_DECIMALS)} tNIGHT`;

const DEFAULT_CHAIN_CALL_TIMEOUT_MS = 30 * 60_000;
const DEFAULT_SYNC_TIMEOUT_MS = 60 * 60_000;
const DEFAULT_DUST_TIMEOUT_MS = 45 * 60_000;
/** Giới hạn của setTimeout: lớn hơn thì Node bắn sau 1 ms. */
const MAX_TIMER_MS = 2_147_483_647;
const DEFAULT_TIMEOUT_HINT = 'Bấm Thử lại để tiếp tục.';
const DEPLOY_TIMEOUT_HINT = 'Kiểm tra ví trước khi bấm Thử lại vì giao dịch có thể vẫn được xác nhận.';

class ChainTimeoutError extends Error {}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${Math.round(ms / 1000)} giây`;
  return `${Math.round(ms / 60_000)} phút`;
}

/** Từ chối khi `promise` không xong sau `ms`; luôn dọn timer khi promise đã settle. */
function withTimeout<T>(promise: Promise<T>, rawMs: number, label: string, hint = DEFAULT_TIMEOUT_HINT): Promise<T> {
  const ms = Number.isNaN(rawMs) ? MAX_TIMER_MS : Math.min(Math.max(rawMs, 0), MAX_TIMER_MS);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new ChainTimeoutError(`${label} quá thời gian chờ (${formatDuration(ms)}). ${hint}`)),
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
      // Kiểm tra lại ngay trước khi ghi (không có await giữa hai bước): bấm đúp không tạo hai ví tổng.
      if (kind === 'treasury' && this.d.store.getTreasury()) throw new Error('Đã có ví tổng');
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

  /**
   * Gọi định kỳ: ví đang chờ (faucet / ví tổng) được kiểm tra lại. Ví tổng đang funding luôn được kiểm tra;
   * ví con funding chỉ được đưa vào hàng khi ví tổng đã ready (nếu không, mở và đồng bộ ví con là vô ích
   * và làm nghẽn hàng đợi, ví tổng không kịp phát hiện tNIGHT từ faucet).
   */
  pollWaiting() {
    const treasuryReady = this.d.store.getTreasury()?.status === 'ready';
    for (const w of this.d.store.listWallets()) {
      if (w.status !== 'funding' || w.failedStep !== null) continue;
      if (w.kind === 'treasury' || treasuryReady) this.queue.enqueue({ type: 'wallet', id: w.id });
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
  private async guarded<T>(
    walletId: string,
    label: string,
    promise: Promise<T>,
    opts: { ms?: number; hint?: string } = {},
  ): Promise<T> {
    try {
      return await withTimeout(promise, opts.ms ?? this.d.chainCallTimeoutMs ?? DEFAULT_CHAIN_CALL_TIMEOUT_MS, label, opts.hint);
    } catch (e) {
      if (e instanceof ChainTimeoutError) {
        const stuck = this.open.get(walletId);
        this.open.delete(walletId);
        if (stuck) await stuck.close().catch(() => undefined);
      }
      throw e;
    }
  }

  /** balances(true) có thể chờ đồng bộ mãi: bọc bằng syncTimeoutMs. */
  private syncBalances(walletId: string, cw: ChainWallet) {
    return this.guarded(walletId, 'Đồng bộ ví', cw.balances(true), { ms: this.d.syncTimeoutMs ?? DEFAULT_SYNC_TIMEOUT_MS });
  }

  private async getOpen(w: WalletRecord): Promise<ChainWallet> {
    const cached = this.open.get(w.id);
    if (cached) return cached;
    const opened = await withTimeout(
      this.d.chain.open(this.d.network, this.d.vault.decrypt(w.encryptedMnemonic)),
      this.d.syncTimeoutMs ?? DEFAULT_SYNC_TIMEOUT_MS,
      'Mở ví',
    );
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
    // Ví tổng vừa sẵn sàng: ví con đang chờ được chạy tiếp ngay, không đợi lượt pollWaiting kế tiếp.
    if (w.kind === 'treasury') this.pollWaiting();
  }

  private async runStep(step: WalletStep, w: WalletRecord): Promise<'ok' | 'wait'> {
    if (step === 'funding') return this.stepFunding(w);
    const cw = await this.getOpen(w);
    if (step === 'syncing') {
      this.saveBalances(w.id, await this.syncBalances(w.id, cw));
      return 'ok';
    }
    await this.guarded(w.id, 'Đăng ký DUST', cw.ensureDust(), { ms: this.d.dustTimeoutMs ?? DEFAULT_DUST_TIMEOUT_MS });
    this.saveBalances(w.id, await this.syncBalances(w.id, cw));
    return 'ok';
  }

  private async stepFunding(w: WalletRecord): Promise<'ok' | 'wait'> {
    if (w.kind === 'treasury') {
      const cw = await this.getOpen(w);
      const mine = await this.syncBalances(w.id, cw);
      this.saveBalances(w.id, mine);
      if (mine.night > 0n) return 'ok';
      this.patchWallet(w.id, {
        message: `Chờ tNIGHT từ faucet. Xin tại ${this.d.network.faucetUrl} cho địa chỉ ${w.unshieldedAddress}`,
      });
      return 'wait';
    }

    // Kiểm tra ví tổng (theo status đã lưu, không gọi chuỗi) TRƯỚC khi mở ví con: mở + đồng bộ lần đầu tốn
    // khoảng 20 phút, vô ích khi ví tổng chưa thể cấp tiền.
    const treasury = this.d.store.getTreasury();
    if (!treasury || treasury.status !== 'ready') {
      this.patchWallet(w.id, { message: 'Chờ ví tổng sẵn sàng (cần có tNIGHT và DUST) để cấp tNIGHT cho ví này' });
      return 'wait';
    }

    const cw = await this.getOpen(w);
    const mine = await this.syncBalances(w.id, cw);
    this.saveBalances(w.id, mine);
    const fund = this.d.fundAmount;
    const waitMs = this.d.waitFundMs ?? 10 * 60_000;
    if (mine.night >= fund) {
      this.clearFundingMarker(w.id);
      return 'ok';
    }
    const tw = await this.getOpen(treasury);
    const tb = await this.syncBalances(treasury.id, tw);
    this.saveBalances(treasury.id, tb);

    // Dấu "đã gửi chuyển tiền" (bền vững) chống chuyển hai lần khi giao dịch đã gửi nhưng chưa xác nhận.
    const marker = this.readFundingMarker(w.id);
    if (marker) {
      if (tb.night <= marker.treasuryBefore - fund) {
        // Ví tổng đã bị trừ => giao dịch đã lên chuỗi: chỉ chờ, tuyệt đối không chuyển lại.
        if (await cw.waitNight(fund, waitMs)) {
          this.clearFundingMarker(w.id);
          this.saveBalances(w.id, await this.syncBalances(w.id, cw));
          return 'ok';
        }
        this.patchWallet(w.id, { message: 'Giao dịch chuyển tNIGHT đã gửi nhưng chưa được xác nhận, đang chờ…' });
        return 'wait';
      }
      this.clearFundingMarker(w.id); // giao dịch cũ chưa từng tới chuỗi: được phép chuyển lại
    }

    if (tb.night < fund) {
      throw new Error(
        `Ví tổng không đủ tNIGHT (còn ${night(tb.night)}, cần ${night(fund)}). ` +
          'Xin thêm tNIGHT từ faucet cho ví tổng rồi bấm Thử lại.',
      );
    }
    // Ghi dấu TRƯỚC khi gửi: nếu app sập hoặc quá thời gian giữa chừng, dấu vẫn còn.
    this.d.store.setMeta(fundingKey(w.id), JSON.stringify({ treasuryBefore: tb.night.toString(), at: Date.now() }));
    await this.guarded(treasury.id, 'Chuyển tNIGHT', tw.transferNight(w.unshieldedAddress, fund));
    if (!(await cw.waitNight(fund, waitMs))) {
      throw new Error(
        `Đã chuyển tNIGHT nhưng ví chưa nhận được sau ${formatDuration(waitMs)}. ` +
          'Bấm Thử lại: app sẽ chờ giao dịch đã gửi, không chuyển lại.',
      );
    }
    this.clearFundingMarker(w.id);
    this.saveBalances(w.id, await this.syncBalances(w.id, cw));
    return 'ok';
  }

  private readFundingMarker(walletId: string): { treasuryBefore: bigint; at: number } | null {
    const raw = this.d.store.getMeta(fundingKey(walletId));
    if (!raw) return null;
    try {
      const p = JSON.parse(raw) as { treasuryBefore: string; at: number };
      return { treasuryBefore: BigInt(p.treasuryBefore), at: Number(p.at) };
    } catch {
      return null; // dấu hỏng coi như không có
    }
  }

  private clearFundingMarker(walletId: string) {
    if (this.d.store.getMeta(fundingKey(walletId))) this.d.store.setMeta(fundingKey(walletId), '');
  }

  private async runRefresh(id: string) {
    const w = this.d.store.getWallet(id);
    if (!w) return;
    try {
      const cw = await this.getOpen(w);
      this.saveBalances(id, await this.syncBalances(w.id, cw));
    } catch (e) {
      this.patchWallet(id, { message: `Không làm mới được số dư: ${errMsg(e)}` });
    }
  }

  private async runToken(id: string) {
    let t = this.d.store.getToken(id);
    if (!t || t.status === 'done') return;
    const w = this.d.store.getWallet(t.walletId);
    if (!w || w.status !== 'ready') {
      this.patchToken(id, { status: 'failed', failedStep: t?.contractAddress ? 'minting' : 'deploying', message: 'Ví chưa sẵn sàng (cần có DUST). Đợi ví về trạng thái Sẵn sàng rồi thử lại.' });
      return;
    }
    let step: 'deploying' | 'minting' = t.contractAddress ? 'minting' : 'deploying';
    try {
      const cw = await this.getOpen(w);
      const b = await this.syncBalances(w.id, cw);
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
          { hint: DEPLOY_TIMEOUT_HINT },
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
      try {
        this.saveBalances(w.id, await cw.balances(false));
      } catch {
        /* token đã done; số dư sẽ được cập nhật ở lần làm mới sau, không được ghi đè trạng thái */
      }
    } catch (e) {
      this.patchToken(id, { status: 'failed', failedStep: step, message: errMsg(e) });
    }
  }
}
