import { deriveKeys } from '../src/chain/keys';
import type { NetworkConfig } from '../src/config/networks';
import type { Chain, ChainWallet, DeployArgs, MintArgs } from '../src/chain/types';

export interface FakeState {
  /** số dư theo mnemonic */
  night: Map<string, bigint>;
  dust: Map<string, bigint>;
  /** contract đã deploy: địa chỉ → trạng thái */
  contracts: Map<string, { minted: boolean; amount: bigint; color: string }>;
  calls: string[];
  failOnce: Set<string>;
  /** tên thao tác → số lần còn phải ném lỗi (như failOnce nhưng nhiều lần liên tiếp) */
  failCount: Map<string, number>;
  /** nếu đặt: nội dung lỗi giả lập (thay cho "lỗi giả lập ở <tên>"), vd. để kiểm tra che khóa bí mật */
  failMessage: string | null;
  /** tên thao tác ("ensureDust" | "transfer" | "transferAfter" (treo sau khi đã trừ tiền) | "deploy" | "mint" | "balances" (chỉ khi sync=true)) sẽ treo mãi, như khi chờ finalization không bao giờ tới */
  hang: Set<string>;
  /** tên thao tác → số ms chờ trước khi chạy tiếp (vd. "ensureDust" chậm nhưng vẫn xong) */
  delayMs: Map<string, number>;
  /** true: transferNight trừ tiền người gửi ngay nhưng hoãn cộng cho người nhận tới khi gọi releaseCredits() */
  holdCredit: boolean;
  pendingCredits: Array<{ to: string; amount: bigint }>;
  opened: number;
  /** >0: open() chỉ trả ví sau ngần này ms (như đồng bộ lần đầu chậm) */
  openDelayMs: number;
  closed: number;
  /** mnemonic của từng ví bị đóng, theo thứ tự */
  closedMnemonics: string[];
  balanceCalls: number;
}

/**
 * Chain giả. Mỗi lần `open` đăng ký địa chỉ ví → mnemonic, nên chuyển NIGHT tới một ví
 * hoạt động ngay khi ví nhận đã được mở (Engine luôn mở ví nhận trước khi ví tổng chuyển).
 */
export function makeFakeChain() {
  const state: FakeState = {
    night: new Map(), dust: new Map(), contracts: new Map(), calls: [], failOnce: new Set(), failCount: new Map(), failMessage: null, hang: new Set(), delayMs: new Map(), holdCredit: false, pendingCredits: [],
    opened: 0, openDelayMs: 0, closed: 0, closedMnemonics: [], balanceCalls: 0,
  };
  const addrToMnemonic = new Map<string, string>();
  let seq = 0;

  const maybeHang = async (name: string) => {
    const delay = state.delayMs.get(name);
    if (delay) await new Promise((r) => setTimeout(r, delay));
    if (state.hang.has(name)) await new Promise<never>(() => undefined);
  };

  const maybeFail = (name: string) => {
    const fail = () => new Error(state.failMessage ?? `lỗi giả lập ở ${name}`);
    if (state.failOnce.has(name)) {
      state.failOnce.delete(name);
      throw fail();
    }
    const left = state.failCount.get(name) ?? 0;
    if (left > 0) {
      state.failCount.set(name, left - 1);
      throw fail();
    }
  };

  const chain: Chain = {
    async open(network: NetworkConfig, mnemonic: string): Promise<ChainWallet> {
      state.opened++;
      addrToMnemonic.set((await deriveKeys(mnemonic, network.networkId)).unshieldedAddress, mnemonic);
      if (state.openDelayMs > 0) await new Promise((r) => setTimeout(r, state.openDelayMs));
      const w: ChainWallet = {
        async balances(sync: boolean) {
          state.balanceCalls++;
          if (sync) {
            await maybeHang('balances');
            maybeFail('balances');
          } else maybeFail('balancesFinal');
          return { night: state.night.get(mnemonic) ?? 0n, dust: state.dust.get(mnemonic) ?? 0n, synced: true };
        },
        async waitNight(min) {
          return (state.night.get(mnemonic) ?? 0n) >= min;
        },
        async ensureDust() {
          state.calls.push(`ensureDust:${mnemonic}`);
          await maybeHang('ensureDust');
          maybeFail('ensureDust');
          if ((state.night.get(mnemonic) ?? 0n) > 0n) state.dust.set(mnemonic, 5_000_000_000_000_000n);
        },
        async transferNight(to, amount) {
          state.calls.push(`transfer:${mnemonic}->${to}:${amount}`);
          await maybeHang('transfer');
          maybeFail('transfer');
          state.night.set(mnemonic, (state.night.get(mnemonic) ?? 0n) - amount);
          const target = addrToMnemonic.get(to);
          if (target) {
            if (state.holdCredit) state.pendingCredits.push({ to: target, amount });
            else state.night.set(target, (state.night.get(target) ?? 0n) + amount);
          }
          await maybeHang('transferAfter');
          return 'tx-transfer';
        },
        async deployToken(a: DeployArgs) {
          state.calls.push(`deploy:${a.symbol}`);
          await maybeHang('deploy');
          maybeFail('deploy');
          const address = `contract-${++seq}`.padEnd(64, '0');
          state.contracts.set(address, { minted: false, amount: 0n, color: '' });
          return { contractAddress: address, txId: `tx-deploy-${seq}` };
        },
        async mintToken(a: MintArgs) {
          state.calls.push(`mint:${a.contractAddress}`);
          await maybeHang('mint');
          maybeFail('mint');
          const c = state.contracts.get(a.contractAddress);
          if (!c) throw new Error('contract không tồn tại');
          if (c.minted) return { txId: 'already-minted', tokenColor: c.color, minted: c.amount };
          c.minted = true;
          c.amount = a.baseUnits;
          c.color = `color-${a.contractAddress.slice(0, 12)}`.padEnd(64, '0');
          return { txId: `tx-mint-${seq}`, tokenColor: c.color, minted: c.amount };
        },
        async close() {
          state.closed++;
          state.closedMnemonics.push(mnemonic);
        },
      };
      return w;
    },
  };
  /** Áp dụng các khoản cộng tiền đang bị hoãn (holdCredit). */
  const releaseCredits = () => {
    for (const c of state.pendingCredits.splice(0)) state.night.set(c.to, (state.night.get(c.to) ?? 0n) + c.amount);
  };
  return { chain, state, releaseCredits };
}
