import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { Engine } from '../src/engine/engine';
import { openStore } from '../src/db/store';
import { createVault, makeSalt } from '../src/lib/vault';
import { getNetworkConfig } from '../src/config/networks';
import { makeFakeChain } from './fake-chain';

const network = getNetworkConfig('preview', {});

function setup() {
  return new Engine({
    store: openStore(':memory:'),
    vault: createVault('mat-khau-chu-123', makeSalt()),
    chain: makeFakeChain().chain,
    network,
    bus: new EventEmitter(),
    fundAmount: 100_000_000n,
    waitFundMs: 10,
  });
}

describe('Engine — giá trị trả về của retry/refresh/enqueueToken (F12)', () => {
  it('retryWallet và refreshWallet trả false khi việc cùng loại đang xếp hàng/đang chạy, true khi nhận việc mới', async () => {
    const engine = setup();
    const [w] = await engine.createWallets(1, 'treasury'); // job ví đã được xếp hàng và đang chạy
    expect(engine.retryWallet(w.id)).toBe(false);
    expect(engine.refreshWallet(w.id)).toBe(true);
    expect(engine.refreshWallet(w.id)).toBe(false);
    await engine.idle();
    expect(engine.retryWallet(w.id)).toBe(true);
    await engine.idle();
    await engine.closeAll();
  });

  it('enqueueToken trả true lần đầu, false khi trùng', async () => {
    const engine = setup();
    expect(engine.enqueueToken('khong-co')).toBe(true);
    expect(engine.enqueueToken('khong-co')).toBe(false);
    await engine.idle();
    expect(engine.enqueueToken('khong-co')).toBe(true);
    await engine.idle();
  });
});
