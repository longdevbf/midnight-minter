import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import * as rt from '@midnight-ntwrk/compact-runtime';
import { beforeAll, describe, expect, it } from 'vitest';

const entry = resolve(__dirname, '../../managed/token/contract/index.js');
type Mod = typeof import('../../managed/token/contract/index.js');
let mod: Mod;

const sk = new Uint8Array(32).fill(7);
const badSk = new Uint8Array(32).fill(8);
const imgHash = new Uint8Array(32).fill(1);
const coinPk = '00'.repeat(32);
const recipient = { bytes: new Uint8Array(32).fill(5) };

function fresh() {
  const c = new mod.Contract({});
  const init = c.initialState(
    rt.createConstructorContext({}, coinPk),
    sk, 'Papa Coin #1', 'PAPA1', 6n, 'ipfs://bafyTEST', imgHash,
  );
  const ctx = rt.createCircuitContext(rt.sampleContractAddress(), coinPk, init.currentContractState, init.currentPrivateState);
  return { c, ctx };
}

describe('token.compact', () => {
  beforeAll(async () => {
    if (!existsSync(entry)) throw new Error('Chưa biên dịch contract. Chạy: npm run contract:build');
    mod = await import('../../managed/token/contract/index.js');
  });

  it('constructor ghi đủ metadata vào ledger', () => {
    const { ctx } = fresh();
    const l = mod.ledger(ctx.currentQueryContext.state);
    expect(l.token_name).toBe('Papa Coin #1');
    expect(l.token_symbol).toBe('PAPA1');
    expect(l.token_decimals).toBe(6n);
    expect(l.image_uri).toBe('ipfs://bafyTEST');
    expect(Buffer.from(l.image_sha256).equals(Buffer.from(imgHash))).toBe(true);
    expect(l.minted).toBe(false);
    expect(l.minted_amount).toBe(0n);
  });

  it('chủ sở hữu mint thành công, ghi số lượng và màu token', () => {
    const { c, ctx } = fresh();
    const r = c.impureCircuits.mint(ctx, sk, 1000n, recipient);
    const l = mod.ledger(r.context.currentQueryContext.state);
    expect(l.minted).toBe(true);
    expect(l.minted_amount).toBe(1000n);
    expect(l.token_color).toHaveLength(32);
    expect(Buffer.from(l.token_color).equals(Buffer.alloc(32))).toBe(false);
  });

  it('người không phải chủ bị từ chối', () => {
    const { c, ctx } = fresh();
    expect(() => c.impureCircuits.mint(ctx, badSk, 1000n, recipient)).toThrow(/not authorized to mint/);
  });

  it('số lượng 0 bị từ chối', () => {
    const { c, ctx } = fresh();
    expect(() => c.impureCircuits.mint(ctx, sk, 0n, recipient)).toThrow(/amount must be positive/);
  });

  it('chỉ mint được một lần', () => {
    const { c, ctx } = fresh();
    const r = c.impureCircuits.mint(ctx, sk, 1000n, recipient);
    expect(() => c.impureCircuits.mint(r.context, sk, 5n, recipient)).toThrow(/already minted/);
  });
});
