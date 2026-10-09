import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { realChain } from '../../src/chain/chain';
import { loadEnv } from '../../src/config/env';
import { getNetworkConfig } from '../../src/config/networks';

const mnemonic = process.env.SPIKE_MNEMONIC;

describe.skipIf(!mnemonic)('deploy + mint token (live)', () => {
  it('deploy contract, mint một lần, và mint lần hai không gửi giao dịch mới', async () => {
    const env = loadEnv();
    const network = getNetworkConfig(env.network, { blockfrostProjectId: env.blockfrostProjectId, proofServerUrl: env.proofServerUrl });
    const w = await realChain.open(network, mnemonic!);
    try {
      const b = await w.balances(true);
      expect(b.dust).toBeGreaterThan(0n);

      const ownerSecret = randomBytes(32);
      const dep = await w.deployToken({
        ownerSecret, name: 'Live Test Coin', symbol: 'LIVE1', decimals: 6,
        imageUri: 'ipfs://bafyTEST', imageSha256Hex: 'ab'.repeat(32),
      });
      expect(dep.contractAddress).toMatch(/^[0-9a-f]{64}$/);

      const minted = await w.mintToken({ contractAddress: dep.contractAddress, ownerSecret, baseUnits: 1_000_000_000n });
      expect(minted.minted).toBe(1_000_000_000n);
      expect(minted.tokenColor).toMatch(/^[0-9a-f]{64}$/);

      const again = await w.mintToken({ contractAddress: dep.contractAddress, ownerSecret, baseUnits: 1_000_000_000n });
      expect(again.txId).toBe('already-minted');
      expect(again.tokenColor).toBe(minted.tokenColor);
    } finally {
      await w.close();
    }
  });
});
