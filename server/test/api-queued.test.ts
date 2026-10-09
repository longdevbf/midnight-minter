import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { Engine } from '../src/engine/engine';
import { openStore, type Store } from '../src/db/store';
import { createSession } from '../src/session';
import { getNetworkConfig } from '../src/config/networks';
import type { TokenRecord } from '../src/types';
import { makeFakeChain } from './fake-chain';

const PASSWORD = 'mat-khau-chu-123';
const network = getNetworkConfig('preview', {});

describe('API — retry/refresh trả { ok, queued } (F12)', () => {
  let app: FastifyInstance;
  let store: Store;
  let engine: Engine;
  let fake: ReturnType<typeof makeFakeChain>;
  let decrypt: (blob: string) => string;
  let encrypt: (plain: string) => string;

  beforeEach(async () => {
    fake = makeFakeChain();
    store = openStore(':memory:');
    const session = createSession(store, (vault, bus) => {
      // chainCallTimeoutMs nhỏ: lệnh treo cuối test tự hết hạn để afterEach không bị kẹt.
      engine = new Engine({ store, vault, chain: fake.chain, network, bus, fundAmount: 100_000_000n, waitFundMs: 10, chainCallTimeoutMs: 400, dustTimeoutMs: 400 });
      return engine;
    });
    decrypt = (b) => session.vault!.decrypt(b);
    encrypt = (p) => session.vault!.encrypt(p);
    app = await buildApp({
      store,
      session,
      ipfs: { pinImage: async () => ({ cid: '', uri: '', gatewayUrl: '' }) },
      network,
      fundAmount: 100_000_000n,
      webDir: null,
    });
    await app.inject({ method: 'POST', url: '/api/unlock', payload: { password: PASSWORD } });
  });
  afterEach(async () => {
    await engine?.idle();
    await app.close();
  });

  it('ví đang chạy (lệnh treo): retry/refresh/retry token trùng trả queued:false, bình thường trả queued:true', async () => {
    const [t] = await engine.createWallets(1, 'treasury');
    await engine.idle();
    fake.state.night.set(decrypt(store.getWallet(t.id)!.encryptedMnemonic), 1_000_000_000n);
    fake.state.hang.add('ensureDust');

    const first = await app.inject({ method: 'POST', url: `/api/wallets/${t.id}/retry` });
    expect(first.statusCode).toBe(202);
    expect(first.json()).toEqual({ ok: true, queued: true });
    await vi.waitFor(() => expect(fake.state.calls.some((c) => c.startsWith('ensureDust:'))).toBe(true));

    const dup = await app.inject({ method: 'POST', url: `/api/wallets/${t.id}/retry` });
    expect(dup.statusCode).toBe(202);
    expect(dup.json()).toEqual({ ok: true, queued: false });

    const refresh1 = await app.inject({ method: 'POST', url: `/api/wallets/${t.id}/refresh` });
    expect(refresh1.json()).toEqual({ ok: true, queued: true });
    const refresh2 = await app.inject({ method: 'POST', url: `/api/wallets/${t.id}/refresh` });
    expect(refresh2.json()).toEqual({ ok: true, queued: false });

    const token: TokenRecord = {
      id: 'tok1', walletId: t.id, name: 'Papa', symbol: 'PAPA', decimals: 6, amountWhole: '10', baseUnits: '10000000',
      imageUri: 'ipfs://cid', imageGatewayUrl: 'https://gw/ipfs/cid', imageSha256: 'ab'.repeat(32),
      encryptedOwnerSecret: encrypt('cd'.repeat(32)),
      contractAddress: null, tokenColor: null, deployTxId: null, mintTxId: null,
      status: 'failed', failedStep: 'deploying', message: 'x', createdAt: Date.now(),
    };
    store.insertToken(token);
    expect((await app.inject({ method: 'POST', url: '/api/tokens/tok1/retry' })).json()).toEqual({ ok: true, queued: true });
    expect((await app.inject({ method: 'POST', url: '/api/tokens/tok1/retry' })).json()).toEqual({ ok: true, queued: false });
  });
});
