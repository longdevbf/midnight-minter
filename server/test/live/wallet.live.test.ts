import { describe, expect, it } from 'vitest';
import { loadEnv } from '../../src/config/env';
import { getNetworkConfig } from '../../src/config/networks';
import { deriveKeys } from '../../src/chain/keys';
import { openWallet, readBalances } from '../../src/chain/wallet-runtime';

const mnemonic = process.env.SPIKE_MNEMONIC;

describe.skipIf(!mnemonic)('ví thật (live)', () => {
  it('đồng bộ ví và có tNIGHT + DUST', async () => {
    const env = loadEnv();
    const network = getNetworkConfig(env.network, { blockfrostProjectId: env.blockfrostProjectId, proofServerUrl: env.proofServerUrl });
    const w = await openWallet(network, await deriveKeys(mnemonic!, network.networkId));
    try {
      const b = await readBalances(w, true);
      expect(b.synced).toBe(true);
      expect(b.night).toBeGreaterThan(0n);
      expect(b.dust).toBeGreaterThan(0n);
    } finally {
      await w.close();
    }
  });
});
