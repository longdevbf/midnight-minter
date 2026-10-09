import { describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ passwords: [] as string[] }));

vi.mock('../src/chain/wallet-runtime', () => ({
  openWallet: vi.fn(async (_n: unknown, _k: unknown, snapshot?: unknown) => ({
    restored: !!snapshot,
    close: async () => undefined,
  })),
  readBalances: vi.fn(),
  waitNight: vi.fn(),
  ensureDust: vi.fn(),
  transferNight: vi.fn(),
}));
vi.mock('../src/chain/token-contract', () => ({
  derivePrivateStatePassword: (s: string) => {
    m.passwords.push(s);
    return `pw:${s}`;
  },
  deployToken: vi.fn(),
  mintToken: vi.fn(),
}));

import { realChain } from '../src/chain/chain';
import { openWallet } from '../src/chain/wallet-runtime';
import { newMnemonic } from '../src/chain/keys';
import { getNetworkConfig } from '../src/config/networks';

describe('realChain.open: chuẩn hóa seedphrase trước khi dẫn xuất mật khẩu kho trạng thái', () => {
  it('khoảng trắng thừa/xuống dòng cho cùng mật khẩu như seedphrase chuẩn', async () => {
    const network = getNetworkConfig('preview', {});
    const mnemonic = newMnemonic();
    const messy = `  ${mnemonic.split(' ').join('   ')}\n`;
    const a = await realChain.open(network, mnemonic);
    const b = await realChain.open(network, messy);
    await a.close();
    await b.close();
    expect(m.passwords).toHaveLength(2);
    expect(m.passwords[1]).toBe(m.passwords[0]);
    expect(m.passwords[0]).toBe(mnemonic);
  });
});

describe('realChain.open: truyền snapshot xuống openWallet (R1)', () => {
  it('có snapshot: openWallet nhận đúng snapshot, restored theo kết quả của openWallet', async () => {
    const network = getNetworkConfig('preview', {});
    const snap = { shielded: 's', unshielded: 'u', dust: 'd' };
    vi.mocked(openWallet).mockClear();
    const a = await realChain.open(network, newMnemonic(), snap);
    const b = await realChain.open(network, newMnemonic());
    expect(vi.mocked(openWallet).mock.calls[0][2]).toEqual(snap);
    expect(vi.mocked(openWallet).mock.calls[1][2]).toBeUndefined();
    expect(a.restored).toBe(true);
    expect(b.restored).toBe(false);
    await a.close();
    await b.close();
  });
});
