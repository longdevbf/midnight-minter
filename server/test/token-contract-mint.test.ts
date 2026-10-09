import { describe, expect, it, vi } from 'vitest';
import { mintToken, type TokenLedgerView } from '../src/chain/token-contract';
import type { OpenWallet } from '../src/chain/wallet-runtime';

const w = {} as OpenWallet; // các phụ thuộc chuỗi đều được tiêm, ví không được dùng tới
const args = { contractAddress: 'c'.repeat(64), ownerSecret: new Uint8Array(32), baseUnits: 1_000n };
const view = (minted: boolean, amount = 0n): TokenLedgerView => ({ minted, minted_amount: amount, token_color: new Uint8Array([0xab, 0xcd]) });

/** readLedger trả lần lượt các giá trị (hoặc ném lỗi), giá trị cuối lặp lại. */
function seq(...items: Array<TokenLedgerView | Error>) {
  let i = 0;
  return vi.fn(async () => {
    const it = items[Math.min(i++, items.length - 1)];
    if (it instanceof Error) throw it;
    return it;
  });
}

describe('mintToken: đọc lại ledger sau khi mint (indexer có thể trễ)', () => {
  it('ledger chưa cập nhật hai lần rồi mới đúng: trả txId thật sau 3 lần đọc', async () => {
    const readLedger = seq(view(false), view(false), view(true, 1_000n));
    const submitMint = vi.fn(async () => 'tx-real');
    const r = await mintToken(w, args, 'pw', { readLedger, submitMint, delayMs: 1 });
    expect(r).toEqual({ txId: 'tx-real', tokenColor: 'abcd', minted: 1_000n });
    expect(readLedger).toHaveBeenCalledTimes(3);
    expect(submitMint).toHaveBeenCalledTimes(1);
  });

  it('lỗi đọc tạm thời trong lúc chờ không làm mất txId', async () => {
    const readLedger = seq(view(false), new Error('indexer 502'), view(true, 1_000n));
    const r = await mintToken(w, args, 'pw', { readLedger, submitMint: async () => 'tx-real', delayMs: 1 });
    expect(r.txId).toBe('tx-real');
  });

  it('ledger không bao giờ đúng: ném lỗi cũ sau đúng số lần thử', async () => {
    const readLedger = seq(view(false));
    await expect(
      mintToken(w, args, 'pw', { readLedger, submitMint: async () => 'tx-real', delayMs: 1, attempts: 4 }),
    ).rejects.toThrow(/ledger trên chuỗi chưa phản ánh đúng số lượng/);
    expect(readLedger).toHaveBeenCalledTimes(1 + 4);
  });

  it('mặc định thử 10 lần', async () => {
    const readLedger = seq(view(false));
    await expect(mintToken(w, args, 'pw', { readLedger, submitMint: async () => 'tx', delayMs: 1 })).rejects.toThrow();
    expect(readLedger).toHaveBeenCalledTimes(1 + 10);
  });

  it('đã mint từ trước (kể cả số lượng khác): already-minted, không gửi giao dịch', async () => {
    const submitMint = vi.fn(async () => 'tx');
    const r = await mintToken(w, args, 'pw', { readLedger: seq(view(true, 7n)), submitMint, delayMs: 1 });
    expect(r).toEqual({ txId: 'already-minted', tokenColor: 'abcd', minted: 7n });
    expect(submitMint).not.toHaveBeenCalled();
  });
});
