import { describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ passwords: [] as string[] }));

vi.mock('../src/chain/wallet-runtime', () => ({
  openWallet: vi.fn(async () => ({ close: async () => undefined })),
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
