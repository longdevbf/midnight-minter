import http from 'node:http';
import type { EventEmitter } from 'node:events';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { Engine } from '../src/engine/engine';
import { openStore, type Store } from '../src/db/store';
import { createSession } from '../src/session';
import { getNetworkConfig } from '../src/config/networks';
import type { Ipfs } from '../src/ipfs/pinata';
import { makeFakeChain } from './fake-chain';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const PASSWORD = 'mat-khau-chu-123';
const network = getNetworkConfig('preview', {});

function multipart(payload: unknown, image?: { data: Buffer; type: string; name: string }) {
  const boundary = '----testboundary';
  const parts: Buffer[] = [];
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="payload"\r\n\r\n${JSON.stringify(payload)}\r\n`));
  if (image) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="${image.name}"\r\nContent-Type: ${image.type}\r\n\r\n`));
    parts.push(image.data, Buffer.from('\r\n'));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: Buffer.concat(parts), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

describe('API', () => {
  let app: FastifyInstance;
  let store: Store;
  let engine: Engine;
  let bus: EventEmitter;
  let pinned: number;
  let pinnedNames: string[];
  let fake: ReturnType<typeof makeFakeChain>;
  let vaultOf: () => { decrypt(blob: string): string };

  beforeEach(async () => {
    pinned = 0;
    pinnedNames = [];
    fake = makeFakeChain();
    store = openStore(':memory:');
    const ipfs: Ipfs = {
      async pinImage(_buf, filename) {
        pinned++;
        pinnedNames.push(filename);
        return { cid: 'bafyCID', uri: 'ipfs://bafyCID', gatewayUrl: 'https://gw/ipfs/bafyCID' };
      },
    };
    const session = createSession(store, (vault, bus) => {
      engine = new Engine({ store, vault, chain: fake.chain, network, bus, fundAmount: 100_000_000n, waitFundMs: 10 });
      return engine;
    });
    vaultOf = () => session.vault!;
    bus = session.bus;
    app = await buildApp({ store, session, ipfs, network, fundAmount: 100_000_000n, webDir: null });
  });
  afterEach(async () => {
    await engine?.idle();
    await app.close();
  });

  const unlock = () => app.inject({ method: 'POST', url: '/api/unlock', payload: { password: PASSWORD } });

  /** Ví tổng có 1000 tNIGHT ("xin faucet" bằng chain giả) và một ví con đi qua vòng đời thật tới Sẵn sàng. */
  async function readyWallet() {
    await unlock();
    const [t] = await engine.createWallets(1, 'treasury');
    await engine.idle();
    const mnemonic = vaultOf().decrypt(store.getWallet(t.id)!.encryptedMnemonic);
    fake.state.night.set(mnemonic, 1_000_000_000n);
    engine.retryWallet(t.id);
    await engine.idle();
    const [c] = await engine.createWallets(1, 'child');
    await engine.idle();
    const ready = store.getWallet(c.id)!;
    expect(ready.status).toBe('ready');
    return ready;
  }

  it('status khi chưa mở khóa', async () => {
    const r = await app.inject({ url: '/api/status' });
    expect(r.json()).toMatchObject({ unlocked: false, initialized: false, network: 'preview' });
  });

  it('các endpoint khác bị chặn khi chưa mở khóa', async () => {
    const r = await app.inject({ url: '/api/wallets' });
    expect(r.statusCode).toBe(401);
    expect(r.json().error).toMatch(/mở khóa/);
  });

  it('mở khóa lần đầu thiết lập mật khẩu; sai mật khẩu sau đó bị từ chối', async () => {
    expect((await unlock()).statusCode).toBe(200);
    expect((await app.inject({ url: '/api/status' })).json()).toMatchObject({ unlocked: true, initialized: true });
    // phiên mới với cùng store: phải nhập đúng mật khẩu
    const session2 = createSession(store, () => engine);
    const app2 = await buildApp({ store, session: session2, ipfs: { pinImage: async () => ({ cid: '', uri: '', gatewayUrl: '' }) }, network, fundAmount: 1n, webDir: null });
    const bad = await app2.inject({ method: 'POST', url: '/api/unlock', payload: { password: 'sai-mat-khau-1' } });
    expect(bad.statusCode).toBe(401);
    expect(bad.json().error).toMatch(/Sai mật khẩu/);
    expect(bad.body).not.toContain('sai-mat-khau-1');
    await app2.close();
  });

  it('mật khẩu quá ngắn bị từ chối', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/unlock', payload: { password: 'ngan' } });
    expect(r.statusCode).toBe(400);
  });

  it('tạo ví: trả về danh sách, KHÔNG chứa mnemonic hay trường mã hóa', async () => {
    await unlock();
    const r = await app.inject({ method: 'POST', url: '/api/wallets', payload: { count: 2 } });
    expect(r.statusCode).toBe(201);
    const body = r.body;
    expect(JSON.parse(body)).toHaveLength(2);
    expect(body).not.toMatch(/mnemonic|encrypted|v1:/i);
    const list = await app.inject({ url: '/api/wallets' });
    expect(list.body).not.toMatch(/mnemonic|encrypted|v1:/i);
    await engine.idle();
  });

  it('giới hạn số ví mỗi lần tạo', async () => {
    await unlock();
    expect((await app.inject({ method: 'POST', url: '/api/wallets', payload: { count: 0 } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/wallets', payload: { count: 51 } })).statusCode).toBe(400);
  });

  it('xem seedphrase cần đúng mật khẩu chủ', async () => {
    await unlock();
    const [w] = (await app.inject({ method: 'POST', url: '/api/wallets', payload: { count: 1 } })).json();
    await engine.idle();
    const bad = await app.inject({ method: 'POST', url: `/api/wallets/${w.id}/seed`, payload: { password: 'sai-mat-khau-1' } });
    expect(bad.statusCode).toBe(401);
    expect(bad.body).not.toMatch(/mnemonic/);
    expect(bad.body).not.toContain('sai-mat-khau-1');
    const missing = await app.inject({ method: 'POST', url: `/api/wallets/${w.id}/seed`, payload: {} });
    expect(missing.statusCode).toBe(401);
    expect(missing.body).not.toMatch(/mnemonic/);
    const ok = await app.inject({ method: 'POST', url: `/api/wallets/${w.id}/seed`, payload: { password: PASSWORD } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().mnemonic.split(' ')).toHaveLength(24);
  });

  it('ví không tồn tại trả về 404', async () => {
    await unlock();
    expect((await app.inject({ url: '/api/wallets/khong-co' })).statusCode).toBe(404);
  });

  it('mint nhiều ví: sinh name/symbol theo {n}, upload ảnh đúng một lần, token vào hàng đợi', async () => {
    const w1 = await readyWallet();
    const [w2] = await engine.createWallets(1, 'child');
    await engine.idle();
    expect(store.getWallet(w2.id)!.status).toBe('ready');
    const { body, headers } = multipart(
      { walletIds: [w1.id, w2.id], template: { name: 'Papa Coin #{n}', symbol: 'PAPA{n}', decimals: 6, amount: '1000' } },
      { data: PNG, type: 'image/png', name: 'logo.png' },
    );
    const r = await app.inject({ method: 'POST', url: '/api/mint', payload: body, headers });
    expect(r.statusCode).toBe(201);
    const tokens = r.json();
    expect(tokens.map((t: { name: string }) => t.name)).toEqual(['Papa Coin #1', 'Papa Coin #2']);
    expect(tokens.map((t: { symbol: string }) => t.symbol)).toEqual(['PAPA1', 'PAPA2']);
    expect(tokens[0]).toMatchObject({ decimals: 6, amountWhole: '1000', baseUnits: '1000000000', imageUri: 'ipfs://bafyCID' });
    expect(r.body).not.toMatch(/encrypted/i);
    expect(pinned).toBe(1);
    await engine.idle();
    expect(store.getToken(tokens[0].id)!.status).toBe('done');
    expect(store.getToken(tokens[1].id)!.status).toBe('done');
  });

  it('tên file gửi lên Pinata là tên sinh sẵn, không dùng tên file của client', async () => {
    const w1 = await readyWallet();
    const { body, headers } = multipart(
      { walletIds: [w1.id], template: { name: 'Papa', symbol: 'PAPA', decimals: 6, amount: '1' } },
      { data: PNG, type: 'image/png', name: '../../evil.png' },
    );
    const r = await app.inject({ method: 'POST', url: '/api/mint', payload: body, headers });
    expect(r.statusCode).toBe(201);
    const sha = r.json()[0].imageSha256 as string;
    expect(pinnedNames).toEqual([`token-${sha.slice(0, 8)}.png`]);
    expect(pinnedNames[0]).not.toMatch(/evil|[\\/]/);
    await engine.idle();
  });

  it('override name/symbol của một ví', async () => {
    const w1 = await readyWallet();
    const { body, headers } = multipart(
      { walletIds: [w1.id], template: { name: 'Mẫu', symbol: 'MAU', decimals: 0, amount: '5' }, overrides: { [w1.id]: { name: 'Riêng', symbol: 'RIENG' } } },
      { data: PNG, type: 'image/png', name: 'a.png' },
    );
    const r = await app.inject({ method: 'POST', url: '/api/mint', payload: body, headers });
    expect(r.statusCode).toBe(201);
    expect(r.json()[0]).toMatchObject({ name: 'Riêng', symbol: 'RIENG' });
    await engine.idle();
  });

  it('nhiều ví mà symbol trùng nhau (không có {n}) bị từ chối', async () => {
    const w1 = await readyWallet();
    const [w2] = await engine.createWallets(1, 'child');
    await engine.idle();
    const { body, headers } = multipart(
      { walletIds: [w1.id, w2.id], template: { name: 'Papa', symbol: 'PAPA', decimals: 6, amount: '1' } },
      { data: PNG, type: 'image/png', name: 'a.png' },
    );
    const r = await app.inject({ method: 'POST', url: '/api/mint', payload: body, headers });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toMatch(/\{n\}|trùng/);
    expect(pinned).toBe(0);
  });

  it('symbol sinh từ {n} vượt 12 ký tự bị từ chối kèm số thứ tự lỗi', async () => {
    const w1 = await readyWallet();
    const { body, headers } = multipart(
      { walletIds: [w1.id], template: { name: 'Papa', symbol: 'ABCDEFGHIJK{n}', decimals: 6, amount: '1' } },
      { data: PNG, type: 'image/png', name: 'a.png' },
    );
    const r = await app.inject({ method: 'POST', url: '/api/mint', payload: body, headers });
    expect(r.statusCode).toBe(201); // 11 ký tự + "1" = 12, vừa đủ
    const { body: b2, headers: h2 } = multipart(
      { walletIds: [w1.id], template: { name: 'Papa', symbol: 'ABCDEFGHIJKL{n}', decimals: 6, amount: '1' } },
      { data: PNG, type: 'image/png', name: 'a.png' },
    );
    const r2 = await app.inject({ method: 'POST', url: '/api/mint', payload: b2, headers: h2 });
    expect(r2.statusCode).toBe(400);
    expect(r2.json().error).toMatch(/Symbol/);
    await engine.idle();
  });

  it('thiếu ảnh hoặc ảnh giả bị từ chối trước khi upload', async () => {
    const w1 = await readyWallet();
    const tpl = { name: 'Papa', symbol: 'PAPA', decimals: 6, amount: '1' };
    const noImg = multipart({ walletIds: [w1.id], template: tpl });
    const r1 = await app.inject({ method: 'POST', url: '/api/mint', payload: noImg.body, headers: noImg.headers });
    expect(r1.statusCode).toBe(400);
    expect(r1.json().error).toMatch(/ảnh/i);
    const fake1 = multipart({ walletIds: [w1.id], template: tpl }, { data: Buffer.from('<html>'), type: 'image/png', name: 'a.png' });
    const r2 = await app.inject({ method: 'POST', url: '/api/mint', payload: fake1.body, headers: fake1.headers });
    expect(r2.statusCode).toBe(400);
    expect(pinned).toBe(0);
  });

  it('số lượng vượt Uint64 sau khi nhân decimals bị từ chối', async () => {
    const w1 = await readyWallet();
    const { body, headers } = multipart(
      { walletIds: [w1.id], template: { name: 'Papa', symbol: 'PAPA', decimals: 18, amount: '19' } },
      { data: PNG, type: 'image/png', name: 'a.png' },
    );
    const r = await app.inject({ method: 'POST', url: '/api/mint', payload: body, headers });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toMatch(/Uint64/);
  });

  it('ví chưa sẵn sàng không được mint', async () => {
    await unlock();
    const [c] = (await app.inject({ method: 'POST', url: '/api/wallets', payload: { count: 1 } })).json();
    await engine.idle();
    const { body, headers } = multipart(
      { walletIds: [c.id], template: { name: 'Papa', symbol: 'PAPA', decimals: 6, amount: '1' } },
      { data: PNG, type: 'image/png', name: 'a.png' },
    );
    const r = await app.inject({ method: 'POST', url: '/api/mint', payload: body, headers });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toMatch(/chưa sẵn sàng/);
  });

  it('chi tiết ví trả về token của đúng ví đó', async () => {
    const w1 = await readyWallet();
    const { body, headers } = multipart(
      { walletIds: [w1.id], template: { name: 'Papa', symbol: 'PAPA', decimals: 6, amount: '1' } },
      { data: PNG, type: 'image/png', name: 'a.png' },
    );
    await app.inject({ method: 'POST', url: '/api/mint', payload: body, headers });
    await engine.idle();
    const r = (await app.inject({ url: `/api/wallets/${w1.id}` })).json();
    expect(r.wallet.id).toBe(w1.id);
    expect(r.tokens).toHaveLength(1);
    expect(r.tokens[0]).toMatchObject({ symbol: 'PAPA', status: 'done' });
    expect(JSON.stringify(r)).not.toMatch(/encrypted/i);
  });

  it('SSE: gửi sự kiện từ bus và app.close() đóng được kết nối đang mở', async () => {
    await unlock();
    const base = await app.listen({ host: '127.0.0.1', port: 0 });
    const chunks: string[] = [];
    const res = await new Promise<http.IncomingMessage>((resolve, reject) => {
      http.get(`${base}/api/events`, resolve).on('error', reject);
    });
    expect(res.headers['content-type']).toBe('text/event-stream');
    res.on('data', (c: Buffer) => chunks.push(c.toString()));
    await vi.waitFor(() => expect(chunks.join('')).toContain(': connected'));
    bus.emit('change', { kind: 'wallet', id: 'w-1' });
    await vi.waitFor(() => expect(chunks.join('')).toContain('data: {"kind":"wallet","id":"w-1"}'));
    const closed = new Promise<void>((resolve) => res.on('close', () => resolve()));
    await app.close();
    await closed;
  });

  describe('lỗi multipart và dữ liệu mint', () => {
    const tpl = { name: 'Papa', symbol: 'PAPA', decimals: 6, amount: '1' };

    it('ảnh quá 5 MB bị từ chối 413 bằng tiếng Việt và không upload', async () => {
      const w1 = await readyWallet();
      const big = Buffer.concat([PNG, Buffer.alloc(6 * 1024 * 1024)]);
      const { body, headers } = multipart({ walletIds: [w1.id], template: tpl }, { data: big, type: 'image/png', name: 'big.png' });
      const r = await app.inject({ method: 'POST', url: '/api/mint', payload: body, headers });
      expect(r.statusCode).toBe(413);
      expect(r.json().error).toBe('Ảnh quá lớn (tối đa 5 MB)');
      expect(pinned).toBe(0);
    });

    it('gửi hai ảnh bị từ chối 400 bằng tiếng Việt', async () => {
      const w1 = await readyWallet();
      const boundary = '----twoimages';
      const file = (n: string) => [
        Buffer.from('--' + boundary + '\r\nContent-Disposition: form-data; name="image"; filename="' + n + '"\r\nContent-Type: image/png\r\n\r\n'),
        PNG,
        Buffer.from('\r\n'),
      ];
      const body = Buffer.concat([
        Buffer.from('--' + boundary + '\r\nContent-Disposition: form-data; name="payload"\r\n\r\n' + JSON.stringify({ walletIds: [w1.id], template: tpl }) + '\r\n'),
        ...file('a.png'),
        ...file('b.png'),
        Buffer.from('--' + boundary + '--\r\n'),
      ]);
      const r = await app.inject({ method: 'POST', url: '/api/mint', payload: body, headers: { 'content-type': 'multipart/form-data; boundary=' + boundary } });
      expect(r.statusCode).toBe(400);
      expect(r.json().error).toBe('Chỉ được gửi một ảnh cho mỗi lần mint');
      expect(pinned).toBe(0);
    });

    it('quá nhiều trường bị từ chối 400 bằng tiếng Việt', async () => {
      await readyWallet();
      const boundary = '----manyfields';
      const parts = Array.from({ length: 8 }, (_, i) => '--' + boundary + '\r\nContent-Disposition: form-data; name="f' + i + '"\r\n\r\nx\r\n');
      const body = Buffer.from(parts.join('') + '--' + boundary + '--\r\n');
      const r = await app.inject({ method: 'POST', url: '/api/mint', payload: body, headers: { 'content-type': 'multipart/form-data; boundary=' + boundary } });
      expect(r.statusCode).toBe(400);
      expect(r.json().error).toBe('Dữ liệu mint có quá nhiều trường');
      expect(pinned).toBe(0);
    });

    it('POST không phải multipart bị từ chối 400 bằng tiếng Việt', async () => {
      const w1 = await readyWallet();
      const r = await app.inject({ method: 'POST', url: '/api/mint', payload: { walletIds: [w1.id], template: tpl } });
      expect(r.statusCode).toBe(400);
      expect(r.json().error).toBe('Yêu cầu mint phải là multipart/form-data');
      expect(pinned).toBe(0);
    });

    it('walletIds trùng nhau bị từ chối trước khi upload', async () => {
      const w1 = await readyWallet();
      const { body, headers } = multipart({ walletIds: [w1.id, w1.id], template: tpl }, { data: PNG, type: 'image/png', name: 'a.png' });
      const r = await app.inject({ method: 'POST', url: '/api/mint', payload: body, headers });
      expect(r.statusCode).toBe(400);
      expect(r.json().error).toBe('Mỗi ví chỉ được chọn một lần trong một lô mint');
      expect(pinned).toBe(0);
    });
  });

  describe('thông báo lỗi', () => {
    it('5xx không lộ thông điệp gốc, nhưng ghi log phía máy chủ', async () => {
      await unlock();
      const spyErr = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      vi.spyOn(store, 'listWallets').mockImplementation(() => { throw new Error('chi-tiet-noi-bo-bi-mat'); });
      try {
        const r = await app.inject({ url: '/api/wallets' });
        expect(r.statusCode).toBe(500);
        expect(r.json().error).toBe('Lỗi máy chủ nội bộ. Xem log trên máy chạy app.');
        expect(r.body).not.toContain('chi-tiet-noi-bo-bi-mat');
        expect(spyErr).toHaveBeenCalledWith('[api] lỗi:', 'chi-tiet-noi-bo-bi-mat');
      } finally {
        vi.restoreAllMocks();
      }
    });

    it('mật khẩu đúng nhưng dựng engine lỗi: 500 chung, vẫn khóa, thử lại được', async () => {
      const spyErr = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      try {
        let calls = 0;
        const stub = { resume() {}, pollWaiting() {}, closeAll: async () => undefined } as unknown as Engine;
        const store2 = openStore(':memory:');
        const session2 = createSession(store2, () => {
          if (++calls === 1) throw new Error('hong-engine');
          return stub;
        });
        const app2 = await buildApp({ store: store2, session: session2, ipfs: { pinImage: async () => ({ cid: '', uri: '', gatewayUrl: '' }) }, network, fundAmount: 1n, webDir: null });
        const r1 = await app2.inject({ method: 'POST', url: '/api/unlock', payload: { password: PASSWORD } });
        expect(r1.statusCode).toBe(500);
        expect(r1.body).not.toContain('hong-engine');
        expect((await app2.inject({ url: '/api/status' })).json().unlocked).toBe(false);
        const r2 = await app2.inject({ method: 'POST', url: '/api/unlock', payload: { password: PASSWORD } });
        expect(r2.statusCode).toBe(200);
        await app2.close();
        store2.close();
      } finally {
        spyErr.mockRestore();
      }
    });

    it('JSON không hợp lệ trả về 400 bằng tiếng Việt', async () => {
      const r = await app.inject({ method: 'POST', url: '/api/unlock', payload: '{khong-phai-json', headers: { 'content-type': 'application/json' } });
      expect(r.statusCode).toBe(400);
      expect(r.json().error).toBe('Dữ liệu gửi lên không phải JSON hợp lệ');
    });
  });

  it('retry token và ví trả về 202', async () => {
    const w1 = await readyWallet();
    expect((await app.inject({ method: 'POST', url: `/api/wallets/${w1.id}/retry` })).statusCode).toBe(202);
    expect((await app.inject({ method: 'POST', url: `/api/wallets/${w1.id}/refresh` })).statusCode).toBe(202);
    expect((await app.inject({ method: 'POST', url: '/api/tokens/khong-co/retry' })).statusCode).toBe(404);
    await engine.idle();
  });
});
