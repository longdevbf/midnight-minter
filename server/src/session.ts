import { EventEmitter } from 'node:events';
import type { Engine } from './engine/engine';
import type { Store } from './db/store';
import { createVault, makeSalt, type Vault } from './lib/vault';

const VERIFIER_PLAIN = 'minter-ok';
const POLL_INTERVAL_MS = 60_000;
const DEFAULT_SHUTDOWN_DEADLINE_MS = 30_000;

export interface Session {
  readonly bus: EventEmitter;
  readonly vault: Vault | null;
  readonly engine: Engine | null;
  initialized(): boolean;
  unlock(password: string): void;
  verifyPassword(password: string): boolean;
  /** Dừng timer poll rồi đóng engine; không chờ quá `shutdownDeadlineMs` nếu có job treo. */
  close(): Promise<void>;
}

export interface SessionOptions {
  /** Thời gian tối đa chờ engine đóng khi tắt máy chủ. Mặc định 30 giây. */
  shutdownDeadlineMs?: number;
}

export function createSession(
  store: Store,
  makeEngine: (vault: Vault, bus: EventEmitter) => Engine,
  opts: SessionOptions = {},
): Session {
  const bus = new EventEmitter();
  // Mỗi tab SSE gắn một listener 'change'; không giới hạn để khỏi bị cảnh báo khi mở nhiều tab.
  bus.setMaxListeners(0);
  const deadlineMs = opts.shutdownDeadlineMs ?? DEFAULT_SHUTDOWN_DEADLINE_MS;
  let vault: Vault | null = null;
  let engine: Engine | null = null;
  let timer: NodeJS.Timeout | null = null;

  function verifyPassword(password: string): boolean {
    const saltHex = store.getMeta('vault_salt');
    if (!saltHex) return false;
    try {
      return createVault(password, Buffer.from(saltHex, 'hex')).decrypt(store.getMeta('vault_check') as string) === VERIFIER_PLAIN;
    } catch {
      return false;
    }
  }

  return {
    bus,
    get vault() { return vault; },
    get engine() { return engine; },
    initialized: () => store.getMeta('vault_salt') !== null,
    unlock(password) {
      if (vault) {
        // Đã mở khóa: vẫn phải đúng mật khẩu, nếu không "mở khóa" thành lối vòng kiểm tra mật khẩu.
        if (!verifyPassword(password)) throw new Error('Sai mật khẩu chủ');
        return;
      }
      const saltHex = store.getMeta('vault_salt');
      let v: Vault;
      if (!saltHex) {
        const salt = makeSalt();
        v = createVault(password, salt);
        store.setMeta('vault_salt', salt.toString('hex'));
        store.setMeta('vault_check', v.encrypt(VERIFIER_PLAIN));
      } else {
        v = createVault(password, Buffer.from(saltHex, 'hex'));
        const check = store.getMeta('vault_check') as string;
        if (v.decrypt(check) !== VERIFIER_PLAIN) throw new Error('Sai mật khẩu chủ');
      }
      // Chỉ chuyển sang trạng thái mở khóa khi engine đã dựng và resume xong; lỗi thì phiên vẫn khóa hoàn toàn.
      const e = makeEngine(v, bus);
      e.resume();
      vault = v;
      engine = e;
      timer = setInterval(() => e.pollWaiting(), POLL_INTERVAL_MS);
      timer.unref();
    },
    verifyPassword,
    async close() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      const current = engine;
      if (!current) return;
      let deadline: NodeJS.Timeout | undefined;
      const expired = new Promise<void>((resolve) => {
        deadline = setTimeout(resolve, deadlineMs);
      });
      try {
        await Promise.race([current.closeAll().catch(() => undefined), expired]);
      } finally {
        clearTimeout(deadline);
      }
    },
  };
}
