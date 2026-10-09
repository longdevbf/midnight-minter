import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { TokenRecord, WalletRecord } from '../types';

const toSnake = (k: string) => k.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
const toCamel = (k: string) => k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
const fromRow = <T>(row: Record<string, unknown> | undefined): T | null => {
  if (!row) return null;
  return Object.fromEntries(Object.entries(row).map(([k, v]) => [toCamel(k), v])) as T;
};

const WALLET_UPDATABLE = new Set(['label', 'status', 'failedStep', 'message', 'nightBalance', 'dustBalance']);
const TOKEN_UPDATABLE = new Set([
  'status', 'failedStep', 'message', 'contractAddress', 'tokenColor', 'deployTxId', 'mintTxId',
]);

const WALLET_COLUMNS = new Set([
  'id', 'label', 'kind', 'network', 'unshieldedAddress', 'encryptedMnemonic', 'status',
  'failedStep', 'message', 'nightBalance', 'dustBalance', 'createdAt',
]);
const TOKEN_COLUMNS = new Set([
  'id', 'walletId', 'name', 'symbol', 'decimals', 'amountWhole', 'baseUnits', 'imageUri',
  'imageGatewayUrl', 'imageSha256', 'encryptedOwnerSecret', 'contractAddress', 'tokenColor',
  'deployTxId', 'mintTxId', 'status', 'failedStep', 'message', 'createdAt',
]);

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS wallets (
  id TEXT PRIMARY KEY, label TEXT NOT NULL, kind TEXT NOT NULL, network TEXT NOT NULL,
  unshielded_address TEXT NOT NULL UNIQUE, encrypted_mnemonic TEXT NOT NULL,
  status TEXT NOT NULL, failed_step TEXT, message TEXT,
  night_balance TEXT NOT NULL DEFAULT '0', dust_balance TEXT NOT NULL DEFAULT '0',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS tokens (
  id TEXT PRIMARY KEY, wallet_id TEXT NOT NULL REFERENCES wallets(id),
  name TEXT NOT NULL, symbol TEXT NOT NULL, decimals INTEGER NOT NULL,
  amount_whole TEXT NOT NULL, base_units TEXT NOT NULL,
  image_uri TEXT NOT NULL, image_gateway_url TEXT NOT NULL, image_sha256 TEXT NOT NULL,
  encrypted_owner_secret TEXT NOT NULL,
  contract_address TEXT, token_color TEXT, deploy_tx_id TEXT, mint_tx_id TEXT,
  status TEXT NOT NULL, failed_step TEXT, message TEXT, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tokens_wallet ON tokens(wallet_id);
`;

export interface Store {
  getMeta(key: string): string | null;
  setMeta(key: string, value: string): void;
  insertWallet(w: WalletRecord): void;
  getWallet(id: string): WalletRecord | null;
  getTreasury(): WalletRecord | null;
  listWallets(): WalletRecord[];
  updateWallet(id: string, patch: Partial<WalletRecord>): WalletRecord;
  listIncompleteWallets(): WalletRecord[];
  insertToken(t: TokenRecord): void;
  getToken(id: string): TokenRecord | null;
  listTokens(walletId: string): TokenRecord[];
  countTokens(walletId: string): number;
  updateToken(id: string, patch: Partial<TokenRecord>): TokenRecord;
  listIncompleteTokens(): TokenRecord[];
  close(): void;
}

function insertRow(db: Database.Database, table: string, rec: object, allowed: Set<string>) {
  for (const k of Object.keys(rec)) {
    if (!allowed.has(k)) throw new Error(`Cột ${k} không hợp lệ`);
  }
  const cols = Object.keys(rec).map(toSnake);
  const sql = `INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map((c) => `@${c}`).join(',')})`;
  db.prepare(sql).run(Object.fromEntries(Object.entries(rec).map(([k, v]) => [toSnake(k), v])));
}

function updateRow(db: Database.Database, table: string, id: string, patch: object, allowed: Set<string>) {
  const entries = Object.entries(patch);
  for (const [k] of entries) {
    if (!allowed.has(k)) throw new Error(`Cột ${k} không được phép cập nhật`);
  }
  if (entries.length === 0) {
    if (!db.prepare(`SELECT 1 FROM ${table} WHERE id = ?`).get(id)) throw new Error(`Không tìm thấy bản ghi ${table} với id ${id}`);
    return;
  }
  const sets = entries.map(([k]) => `${toSnake(k)} = @${toSnake(k)}`).join(', ');
  const result = db.prepare(`UPDATE ${table} SET ${sets} WHERE id = @id`).run({
    id,
    ...Object.fromEntries(entries.map(([k, v]) => [toSnake(k), v])),
  });
  if (result.changes === 0) throw new Error(`Không tìm thấy bản ghi ${table} với id ${id}`);
}

export function openStore(path: string): Store {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);

  const one = <T>(sql: string, ...args: unknown[]) => fromRow<T>(db.prepare(sql).get(...args) as never);
  const many = <T>(sql: string, ...args: unknown[]) =>
    (db.prepare(sql).all(...args) as Record<string, unknown>[]).map((r) => fromRow<T>(r) as T);

  return {
    getMeta: (key) => (db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined)?.value ?? null,
    setMeta: (key, value) => {
      db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
    },
    insertWallet: (w) => insertRow(db, 'wallets', w, WALLET_COLUMNS),
    getWallet: (id) => one<WalletRecord>('SELECT * FROM wallets WHERE id = ?', id),
    getTreasury: () => one<WalletRecord>("SELECT * FROM wallets WHERE kind = 'treasury' LIMIT 1"),
    listWallets: () => many<WalletRecord>('SELECT * FROM wallets ORDER BY created_at ASC, rowid ASC'),
    updateWallet(id, patch) {
      updateRow(db, 'wallets', id, patch, WALLET_UPDATABLE);
      return one<WalletRecord>('SELECT * FROM wallets WHERE id = ?', id) as WalletRecord;
    },
    listIncompleteWallets: () =>
      many<WalletRecord>("SELECT * FROM wallets WHERE status NOT IN ('ready','failed') ORDER BY created_at ASC"),
    insertToken: (t) => insertRow(db, 'tokens', t, TOKEN_COLUMNS),
    getToken: (id) => one<TokenRecord>('SELECT * FROM tokens WHERE id = ?', id),
    listTokens: (walletId) =>
      many<TokenRecord>('SELECT * FROM tokens WHERE wallet_id = ? ORDER BY created_at DESC, rowid DESC', walletId),
    countTokens: (walletId) =>
      (db.prepare('SELECT COUNT(*) AS c FROM tokens WHERE wallet_id = ?').get(walletId) as { c: number }).c,
    updateToken(id, patch) {
      updateRow(db, 'tokens', id, patch, TOKEN_UPDATABLE);
      return one<TokenRecord>('SELECT * FROM tokens WHERE id = ?', id) as TokenRecord;
    },
    listIncompleteTokens: () =>
      many<TokenRecord>("SELECT * FROM tokens WHERE status IN ('queued','deploying','minting') ORDER BY created_at ASC"),
    close: () => db.close(),
  };
}
