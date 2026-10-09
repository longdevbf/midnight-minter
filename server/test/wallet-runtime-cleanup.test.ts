import { beforeEach, describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => ({
  start: vi.fn(),
  stop: vi.fn(),
}));

vi.mock('@midnightntwrk/wallet-sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@midnightntwrk/wallet-sdk')>();
  return {
    ...actual,
    WalletFacade: { init: vi.fn(async () => ({ start: fake.start, stop: fake.stop })) },
  };
});

import { deriveKeys, newMnemonic } from '../src/chain/keys';
import { getNetworkConfig } from '../src/config/networks';
import { openWallet } from '../src/chain/wallet-runtime';

describe('openWallet dọn dẹp khi khởi động lỗi', () => {
  beforeEach(() => {
    fake.start.mockReset();
    fake.stop.mockReset();
    fake.stop.mockResolvedValue(undefined);
  });

  it('start lỗi: gọi stop đúng 1 lần và ném lại đúng lỗi gốc', async () => {
    const network = getNetworkConfig('preview', {});
    const keys = await deriveKeys(newMnemonic(), network.networkId);
    const boom = new Error('indexer chết');
    fake.start.mockRejectedValue(boom);

    await expect(openWallet(network, keys)).rejects.toBe(boom);
    expect(fake.stop).toHaveBeenCalledTimes(1);
  });

  it('start lỗi và stop cũng lỗi: vẫn ném lỗi gốc', async () => {
    const network = getNetworkConfig('preview', {});
    const keys = await deriveKeys(newMnemonic(), network.networkId);
    const boom = new Error('indexer chết');
    fake.start.mockRejectedValue(boom);
    fake.stop.mockRejectedValue(new Error('stop cũng lỗi'));

    await expect(openWallet(network, keys)).rejects.toBe(boom);
    expect(fake.stop).toHaveBeenCalledTimes(1);
  });

  it('start thành công: trả ví, close() gọi stop 1 lần', async () => {
    const network = getNetworkConfig('preview', {});
    const keys = await deriveKeys(newMnemonic(), network.networkId);
    fake.start.mockResolvedValue(undefined);

    const w = await openWallet(network, keys);
    expect(fake.stop).not.toHaveBeenCalled();
    await w.close();
    expect(fake.stop).toHaveBeenCalledTimes(1);
  });
});
