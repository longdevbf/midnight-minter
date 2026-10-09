import { EventEmitter } from 'node:events';
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { realChain } from '../../src/chain/chain';
import { loadEnv } from '../../src/config/env';
import { getNetworkConfig } from '../../src/config/networks';
import { openStore } from '../../src/db/store';
import { Engine } from '../../src/engine/engine';
import { createVault, makeSalt } from '../../src/lib/vault';
import type { TokenRecord } from '../../src/types';

const treasuryMnemonic = process.env.SPIKE_MNEMONIC; // ví đã có tNIGHT + DUST (Task 7)

describe.skipIf(!treasuryMnemonic)('e2e: ví tổng → ví con → deploy → mint (live)', () => {
  it('chạy trọn vòng đời với một ví con', async () => {
    const env = loadEnv();
    const network = getNetworkConfig(env.network, { blockfrostProjectId: env.blockfrostProjectId, proofServerUrl: env.proofServerUrl });
    const store = openStore(':memory:');
    const vault = createVault('mat-khau-chu-123', makeSalt());
    const engine = new Engine({ store, vault, chain: realChain, network, bus: new EventEmitter(), fundAmount: env.fundAmount });

    // Nhập ví đã nạp tNIGHT làm ví tổng
    const { deriveKeys } = await import('../../src/chain/keys');
    const keys = await deriveKeys(treasuryMnemonic!, network.networkId);
    store.insertWallet({
      id: 'treasury', label: 'Ví tổng', kind: 'treasury', network: network.name,
      unshieldedAddress: keys.unshieldedAddress, encryptedMnemonic: vault.encrypt(treasuryMnemonic!),
      status: 'created', failedStep: null, message: null, nightBalance: '0', dustBalance: '0', createdAt: Date.now(),
    });
    engine.retryWallet('treasury');
    await engine.idle();
    expect(store.getWallet('treasury')!.status).toBe('ready');

    const [child] = await engine.createWallets(1, 'child');
    await engine.idle();
    expect(store.getWallet(child.id)!.status).toBe('ready');
    expect(BigInt(store.getWallet(child.id)!.nightBalance)).toBe(env.fundAmount);

    const token: TokenRecord = {
      id: 'tok', walletId: child.id, name: 'E2E Coin', symbol: 'E2E', decimals: 6, amountWhole: '1000', baseUnits: '1000000000',
      imageUri: 'ipfs://bafyE2E', imageGatewayUrl: 'https://gateway.pinata.cloud/ipfs/bafyE2E', imageSha256: 'cd'.repeat(32),
      encryptedOwnerSecret: vault.encrypt(randomBytes(32).toString('hex')),
      contractAddress: null, tokenColor: null, deployTxId: null, mintTxId: null,
      status: 'queued', failedStep: null, message: null, createdAt: Date.now(),
    };
    store.insertToken(token);
    engine.enqueueToken('tok');
    await engine.idle();

    const done = store.getToken('tok')!;
    expect(done.status).toBe('done');
    expect(done.contractAddress).toMatch(/^[0-9a-f]{64}$/);
    expect(done.tokenColor).toMatch(/^[0-9a-f]{64}$/);
    await engine.closeAll();
  });
});
