import { beforeEach, describe, expect, it } from 'vitest';
import { openStore, type Store } from '../src/db/store';
import { toPublicToken, toPublicWallet, type TokenRecord, type WalletRecord } from '../src/types';

const wallet = (over: Partial<WalletRecord> = {}): WalletRecord => ({
  id: 'w1', label: 'Ví 1', kind: 'child', network: 'preprod',
  unshieldedAddress: 'mn_addr_preprod1xyz', encryptedMnemonic: 'v1:a:b:c',
  status: 'created', failedStep: null, message: null,
  nightBalance: '0', dustBalance: '0', createdAt: 1000, ...over,
});

const token = (over: Partial<TokenRecord> = {}): TokenRecord => ({
  id: 't1', walletId: 'w1', name: 'Papa', symbol: 'PAPA', decimals: 6, amountWhole: '10', baseUnits: '10000000',
  imageUri: 'ipfs://cid', imageGatewayUrl: 'https://gw/ipfs/cid', imageSha256: 'ab'.repeat(32),
  encryptedOwnerSecret: 'v1:x:y:z', contractAddress: null, tokenColor: null, deployTxId: null, mintTxId: null,
  status: 'queued', failedStep: null, message: null, createdAt: 2000, ...over,
});

describe('store', () => {
  let store: Store;
  beforeEach(() => { store = openStore(':memory:'); });

  it('meta: lưu và đọc', () => {
    expect(store.getMeta('salt')).toBeNull();
    store.setMeta('salt', 'abc');
    store.setMeta('salt', 'def');
    expect(store.getMeta('salt')).toBe('def');
  });

  it('ví: thêm, đọc, cập nhật, liệt kê theo thời gian', () => {
    store.insertWallet(wallet({ id: 'a', createdAt: 2 }));
    store.insertWallet(wallet({ id: 'b', createdAt: 1, unshieldedAddress: 'mn_addr_preprod1b' }));
    expect(store.listWallets().map((w) => w.id)).toEqual(['b', 'a']);
    const updated = store.updateWallet('a', { status: 'failed', failedStep: 'funding', message: 'lỗi', nightBalance: '5' });
    expect(updated).toMatchObject({ status: 'failed', failedStep: 'funding', message: 'lỗi', nightBalance: '5' });
    expect(store.getWallet('a')?.label).toBe('Ví 1');
    expect(store.getWallet('zzz')).toBeNull();
  });

  it('cập nhật chỉ cho phép các cột hợp lệ', () => {
    store.insertWallet(wallet());
    expect(() => store.updateWallet('w1', { id: 'hack' } as never)).toThrow(/không được phép/);
  });

  it('ví tổng: chỉ lấy ví kind=treasury', () => {
    store.insertWallet(wallet({ id: 'c1' }));
    expect(store.getTreasury()).toBeNull();
    store.insertWallet(wallet({ id: 'tr', kind: 'treasury', unshieldedAddress: 'mn_addr_preprod1t' }));
    expect(store.getTreasury()?.id).toBe('tr');
  });

  it('địa chỉ ví là duy nhất', () => {
    store.insertWallet(wallet({ id: 'a' }));
    expect(() => store.insertWallet(wallet({ id: 'b' }))).toThrow();
  });

  it('token: thêm, cập nhật, đếm và liệt kê theo ví', () => {
    store.insertWallet(wallet());
    store.insertToken(token({ id: 't1', createdAt: 1 }));
    store.insertToken(token({ id: 't2', createdAt: 2 }));
    expect(store.countTokens('w1')).toBe(2);
    expect(store.listTokens('w1').map((t) => t.id)).toEqual(['t2', 't1']);
    const t = store.updateToken('t1', { status: 'done', contractAddress: 'addr', tokenColor: 'col', mintTxId: 'tx' });
    expect(t).toMatchObject({ status: 'done', contractAddress: 'addr', tokenColor: 'col', mintTxId: 'tx' });
  });

  it('liệt kê việc dở dang để chạy tiếp sau khi mở lại app', () => {
    store.insertWallet(wallet({ id: 'ready', unshieldedAddress: 'a1', status: 'ready' }));
    store.insertWallet(wallet({ id: 'failed', unshieldedAddress: 'a2', status: 'failed' }));
    store.insertWallet(wallet({ id: 'syncing', unshieldedAddress: 'a3', status: 'syncing' }));
    store.insertWallet(wallet({ id: 'funding', unshieldedAddress: 'a4', status: 'funding' }));
    expect(store.listIncompleteWallets().map((w) => w.id).sort()).toEqual(['funding', 'syncing']);
    store.insertWallet(wallet({ id: 'w1', unshieldedAddress: 'a5', status: 'ready' })); // ví cha cho token (khóa ngoại)
    store.insertToken(token({ id: 'q', status: 'queued' }));
    store.insertToken(token({ id: 'm', status: 'minting' }));
    store.insertToken(token({ id: 'd', status: 'done' }));
    store.insertToken(token({ id: 'f', status: 'failed' }));
    expect(store.listIncompleteTokens().map((t) => t.id).sort()).toEqual(['m', 'q']);
  });

  it('bản public không chứa trường bí mật', () => {
    const pw = toPublicWallet(wallet(), 3);
    expect(pw).not.toHaveProperty('encryptedMnemonic');
    expect(pw.tokenCount).toBe(3);
    expect(toPublicToken(token())).not.toHaveProperty('encryptedOwnerSecret');
  });
});
