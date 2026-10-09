import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openStore, type Store, type WalletStateRecord } from '../src/db/store';
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
  afterEach(() => { store.close(); });

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
    expect(() => store.insertWallet(wallet({ id: 'b' }))).toThrow(/UNIQUE/);
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

  it('cập nhật id không tồn tại thì báo lỗi', () => {
    expect(() => store.updateWallet('zzz', { status: 'ready' })).toThrow(/Không tìm thấy bản ghi/);
    expect(() => store.updateToken('zzz', { status: 'done' })).toThrow(/Không tìm thấy bản ghi/);
  });

  it('updateToken từ chối cột không cho phép', () => {
    store.insertWallet(wallet());
    store.insertToken(token());
    expect(() => store.updateToken('t1', { walletId: 'x' } as never)).toThrow(/không được phép/);
    expect(store.getToken('t1')?.walletId).toBe('w1');
  });

  it('insert từ chối cột lạ và không ghi gì', () => {
    expect(() => store.insertWallet({ ...wallet(), evil: 'x' } as never)).toThrow(/không hợp lệ/);
    expect(store.listWallets()).toEqual([]);
    store.insertWallet(wallet());
    expect(() => store.insertToken({ ...token(), evil: 'x' } as never)).toThrow(/không hợp lệ/);
    expect(store.countTokens('w1')).toBe(0);
  });

  it('bản public không chứa trường bí mật', () => {
    const pw = toPublicWallet(wallet(), 3);
    expect(pw).not.toHaveProperty('encryptedMnemonic');
    expect(pw.tokenCount).toBe(3);
    expect(toPublicToken(token())).not.toHaveProperty('encryptedOwnerSecret');
  });
});

describe('store — trạng thái ví đã đồng bộ (wallet_state, R1)', () => {
  let store: Store;
  beforeEach(() => { store = openStore(':memory:'); });
  afterEach(() => { store.close(); });

  const state = (over: Partial<WalletStateRecord> = {}): WalletStateRecord => ({
    network: 'preview', sdkVersion: '@midnightntwrk/wallet-sdk@1.2.0', blob: 'v1:a:b:c', savedAt: 1000, ...over,
  });

  it('chưa lưu thì trả null; lưu rồi đọc lại đúng các trường (camelCase)', () => {
    store.insertWallet(wallet());
    expect(store.getWalletState('w1')).toBeNull();
    store.setWalletState('w1', state());
    expect(store.getWalletState('w1')).toEqual(state());
  });

  it('lưu lần hai ghi đè (upsert), không tạo dòng mới', () => {
    store.insertWallet(wallet());
    store.setWalletState('w1', state());
    store.setWalletState('w1', state({ blob: 'v1:d:e:f', savedAt: 2000, network: 'preprod' }));
    expect(store.getWalletState('w1')).toEqual(state({ blob: 'v1:d:e:f', savedAt: 2000, network: 'preprod' }));
  });

  it('xoá: chỉ xoá đúng ví đó; xoá ví chưa có trạng thái thì không lỗi', () => {
    store.insertWallet(wallet({ id: 'a', unshieldedAddress: 'a1' }));
    store.insertWallet(wallet({ id: 'b', unshieldedAddress: 'a2' }));
    store.setWalletState('a', state());
    store.setWalletState('b', state({ blob: 'v1:b:b:b' }));
    store.deleteWalletState('a');
    expect(store.getWalletState('a')).toBeNull();
    expect(store.getWalletState('b')?.blob).toBe('v1:b:b:b');
    expect(() => store.deleteWalletState('a')).not.toThrow();
    expect(() => store.deleteWalletState('zzz')).not.toThrow();
  });

  it('khóa ngoại: không lưu được trạng thái cho ví không tồn tại', () => {
    expect(() => store.setWalletState('zzz', state())).toThrow(/FOREIGN KEY/);
    expect(store.getWalletState('zzz')).toBeNull();
  });

  it('từ chối trường lạ (danh sách trắng) và không ghi gì', () => {
    store.insertWallet(wallet());
    expect(() => store.setWalletState('w1', { ...state(), evil: 'x' } as never)).toThrow(/không hợp lệ/);
    expect(() => store.setWalletState('w1', { network: 'preview' } as never)).toThrow(/thiếu/i);
    expect(store.getWalletState('w1')).toBeNull();
  });

  it('CSDL cũ (chưa có bảng wallet_state) được nâng cấp tự động khi mở', () => {
    const dir = mkdtempSync(join(tmpdir(), 'minter-store-'));
    const path = join(dir, 'old.db');
    try {
      const old = new Database(path);
      old.exec(`CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE wallets (
          id TEXT PRIMARY KEY, label TEXT NOT NULL, kind TEXT NOT NULL, network TEXT NOT NULL,
          unshielded_address TEXT NOT NULL UNIQUE, encrypted_mnemonic TEXT NOT NULL,
          status TEXT NOT NULL, failed_step TEXT, message TEXT,
          night_balance TEXT NOT NULL DEFAULT '0', dust_balance TEXT NOT NULL DEFAULT '0',
          created_at INTEGER NOT NULL);
        INSERT INTO wallets (id, label, kind, network, unshielded_address, encrypted_mnemonic, status, created_at)
          VALUES ('w1', 'Ví 1', 'child', 'preview', 'addr1', 'v1:a:b:c', 'ready', 1);`);
      old.close();
      const s = openStore(path);
      try {
        expect(s.getWallet('w1')?.status).toBe('ready');
        s.setWalletState('w1', state());
        expect(s.getWalletState('w1')).toEqual(state());
      } finally {
        s.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
