import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import type { ServerResponse } from 'node:http';
import { resolve } from 'node:path';
import fastifyMultipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import { z } from 'zod';
import type { NetworkConfig } from './config/networks';
import type { Store } from './db/store';
import type { Ipfs } from './ipfs/pinata';
import { ValidationError, applyTemplate, toBaseUnits, validateImage, validateTokenMeta } from './lib/metadata';
import type { Session } from './session';
import { toPublicToken, toPublicWallet, type TokenRecord } from './types';

export interface AppContext {
  store: Store;
  session: Session;
  ipfs: Ipfs;
  network: NetworkConfig;
  fundAmount: bigint;
  /** thư mục web đã build; null để không phục vụ file tĩnh */
  webDir: string | null;
}

const ALLOWED_HOSTNAMES = new Set([
  'localhost',
  '127.0.0.1',
  '[::1]',
  '173.212.202.229',
  'midnight-minter.texlabs.org',
]);
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Hostname (chữ thường, không cổng; IPv6 giữ ngoặc vuông) của một URL tuyệt đối; null nếu không phân tích được. */
function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

const fail = (reply: FastifyReply, status: number, error: string) => reply.status(status).send({ error });

const MintPayload = z.object({
  walletIds: z.array(z.string()).min(1, 'Chưa chọn ví nào').max(50, 'Tối đa 50 ví mỗi lần'),
  template: z.object({ name: z.string(), symbol: z.string(), decimals: z.number(), amount: z.string() }),
  overrides: z.record(z.object({ name: z.string().optional(), symbol: z.string().optional() })).optional(),
});

/** Lỗi của Fastify/@fastify/multipart (theo err.code) được dịch sang tiếng Việt kèm mã HTTP phù hợp. */
const KNOWN_ERRORS: Record<string, { status: number; message: string }> = {
  FST_REQ_FILE_TOO_LARGE: { status: 413, message: 'Ảnh quá lớn (tối đa 5 MB)' },
  FST_FILES_LIMIT: { status: 400, message: 'Chỉ được gửi một ảnh cho mỗi lần mint' },
  FST_FIELDS_LIMIT: { status: 400, message: 'Dữ liệu mint có quá nhiều trường' },
  FST_PARTS_LIMIT: { status: 400, message: 'Dữ liệu mint có quá nhiều phần' },
  FST_INVALID_MULTIPART_CONTENT_TYPE: { status: 400, message: 'Yêu cầu mint phải là multipart/form-data' },
  FST_MP_PREMATURE_CLOSE: { status: 400, message: 'Yêu cầu mint bị ngắt giữa chừng' },
  FST_ERR_CTP_INVALID_JSON_BODY: { status: 400, message: 'Dữ liệu gửi lên không phải JSON hợp lệ' },
  FST_ERR_CTP_EMPTY_JSON_BODY: { status: 400, message: 'Dữ liệu gửi lên không phải JSON hợp lệ' },
  FST_ERR_CTP_BODY_TOO_LARGE: { status: 413, message: 'Dữ liệu gửi lên quá lớn' },
  FST_ERR_CTP_INVALID_MEDIA_TYPE: { status: 415, message: 'Kiểu dữ liệu gửi lên không được hỗ trợ' },
};

export async function buildApp(ctx: AppContext): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, bodyLimit: 8 * 1024 * 1024 });
  await app.register(fastifyMultipart, { limits: { fileSize: 5 * 1024 * 1024 + 1, files: 1, fields: 5 } });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ValidationError) return fail(reply, 400, err.message);
    const { code, statusCode } = (err ?? {}) as { code?: string; statusCode?: number };
    const known = code ? KNOWN_ERRORS[code] : undefined;
    if (known) return fail(reply, known.status, known.message);
    const status = statusCode ?? 500;
    if (status >= 500) {
      // Chỉ ghi thông điệp lỗi, không ghi body/header/mật khẩu của request.
      console.error('[api] lỗi:', err instanceof Error ? err.message : String(err));
      return fail(reply, status, 'Lỗi máy chủ nội bộ. Xem log trên máy chạy app.');
    }
    return fail(reply, status, err instanceof Error ? err.message : String(err));
  });

  // Chống DNS rebinding / CSRF: chỉ nhận Host loopback; request ghi (không phải GET/HEAD/OPTIONS) mang Origin lạ bị từ chối.
  app.addHook('onRequest', async (req, reply) => {
    const host = hostnameOf(`http://${req.headers.host ?? ''}`);
    if (!host || !ALLOWED_HOSTNAMES.has(host)) return fail(reply, 403, 'Yêu cầu bị từ chối (Host không hợp lệ)');
    if (!SAFE_METHODS.has(req.method)) {
      const origin = req.headers.origin;
      if (origin !== undefined) {
        const originHost = hostnameOf(Array.isArray(origin) ? origin[0] : origin);
        if (!originHost || !ALLOWED_HOSTNAMES.has(originHost)) return fail(reply, 403, 'Yêu cầu bị từ chối (Origin không hợp lệ)');
      }
    }
    const path = req.url.split('?')[0];
    if (!path.startsWith('/api/')) return;
    if (path === '/api/status' || path === '/api/unlock') return;
    if (!ctx.session.engine || !ctx.session.vault) return fail(reply, 401, 'Cần mở khóa bằng mật khẩu chủ trước');
  });

  const engine = () => ctx.session.engine!;
  const vault = () => ctx.session.vault!;
  const publicWallet = (id: string) => {
    const w = ctx.store.getWallet(id);
    return w ? toPublicWallet(w, ctx.store.countTokens(id)) : null;
  };

  app.get('/api/status', async () => ({
    unlocked: ctx.session.engine !== null,
    initialized: ctx.session.initialized(),
    network: ctx.network.name,
    faucetUrl: ctx.network.faucetUrl,
    fundAmount: ctx.fundAmount.toString(),
  }));

  app.post('/api/unlock', async (req, reply) => {
    const { password } = (req.body ?? {}) as { password?: unknown };
    if (typeof password !== 'string' || password.length < 8) return fail(reply, 400, 'Mật khẩu chủ phải có ít nhất 8 ký tự');
    try {
      ctx.session.unlock(password);
    } catch (e) {
      // Mật khẩu đúng nhưng dựng engine lỗi: báo lỗi máy chủ (phiên vẫn khóa), không nói "sai mật khẩu".
      if (ctx.session.verifyPassword(password)) throw e;
      // Không lặp lại thông điệp lỗi gốc: nó có thể chứa dữ liệu từ kho mã hóa.
      return fail(reply, 401, 'Sai mật khẩu chủ');
    }
    return { ok: true };
  });

  app.get('/api/wallets', async () =>
    ctx.store.listWallets().map((w) => toPublicWallet(w, ctx.store.countTokens(w.id))),
  );

  app.post('/api/wallets', async (req, reply) => {
    const parsed = z
      .object({ count: z.number().int().min(1).max(50), kind: z.enum(['child', 'treasury']).default('child') })
      .safeParse(req.body ?? {});
    if (!parsed.success) return fail(reply, 400, 'Số ví phải từ 1 đến 50');
    if (parsed.data.kind === 'treasury' && parsed.data.count !== 1) return fail(reply, 400, 'Chỉ tạo được một ví tổng');
    try {
      const created = await engine().createWallets(parsed.data.count, parsed.data.kind);
      return reply.status(201).send(created.map((w) => toPublicWallet(w, 0)));
    } catch (e) {
      return fail(reply, 400, e instanceof Error ? e.message : String(e));
    }
  });

  app.get('/api/wallets/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const wallet = publicWallet(id);
    if (!wallet) return fail(reply, 404, 'Không tìm thấy ví');
    return { wallet, tokens: ctx.store.listTokens(id).map(toPublicToken) };
  });

  app.post('/api/wallets/:id/retry', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!ctx.store.getWallet(id)) return fail(reply, 404, 'Không tìm thấy ví');
    const queued = engine().retryWallet(id);
    return reply.status(202).send({ ok: true, queued });
  });

  app.post('/api/wallets/:id/refresh', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!ctx.store.getWallet(id)) return fail(reply, 404, 'Không tìm thấy ví');
    const queued = engine().refreshWallet(id);
    return reply.status(202).send({ ok: true, queued });
  });

  app.post('/api/wallets/:id/seed', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { password } = (req.body ?? {}) as { password?: unknown };
    const w = ctx.store.getWallet(id);
    if (!w) return fail(reply, 404, 'Không tìm thấy ví');
    if (typeof password !== 'string' || !ctx.session.verifyPassword(password)) return fail(reply, 401, 'Sai mật khẩu chủ');
    return { mnemonic: vault().decrypt(w.encryptedMnemonic) };
  });

  // Xuất toàn bộ seedphrase: chỉ sau khi xác minh lại mật khẩu chủ; không bao giờ ghi log, không cho cache.
  app.post('/api/export', async (req, reply) => {
    const { password } = (req.body ?? {}) as { password?: unknown };
    if (typeof password !== 'string' || !ctx.session.verifyPassword(password)) return fail(reply, 401, 'Sai mật khẩu chủ');
    const rows = ctx.store.listWallets().map((w) => ({
      label: w.label,
      kind: w.kind,
      network: w.network,
      unshieldedAddress: w.unshieldedAddress,
      mnemonic: vault().decrypt(w.encryptedMnemonic),
    }));
    return reply.header('cache-control', 'no-store').send(rows);
  });

  app.post('/api/tokens/:id/retry', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!ctx.store.getToken(id)) return fail(reply, 404, 'Không tìm thấy token');
    const queued = engine().enqueueToken(id);
    return reply.status(202).send({ ok: true, queued });
  });

  app.post('/api/mint', async (req, reply) => {
    let payloadRaw: string | undefined;
    let image: { data: Buffer; mime: string } | undefined;
    for await (const part of req.parts()) {
      if (part.type === 'file') {
        // toBuffer() tự ném FST_REQ_FILE_TOO_LARGE khi vượt giới hạn; error handler dịch sang tiếng Việt.
        const data = await part.toBuffer();
        // Tên file do client gửi không bao giờ được dùng lại (có thể chứa ký tự đường dẫn).
        image = { data, mime: part.mimetype };
      } else if (part.fieldname === 'payload') {
        payloadRaw = String(part.value);
      }
    }
    let payload: z.infer<typeof MintPayload>;
    try {
      payload = MintPayload.parse(JSON.parse(payloadRaw ?? ''));
    } catch (e) {
      return fail(reply, 400, e instanceof z.ZodError ? e.issues[0].message : 'Dữ liệu mint không hợp lệ');
    }
    if (new Set(payload.walletIds).size !== payload.walletIds.length) {
      return fail(reply, 400, 'Mỗi ví chỉ được chọn một lần trong một lô mint');
    }
    if (!image) return fail(reply, 400, 'Cần chọn ảnh cho token');

    // Kiểm tra toàn bộ trước khi upload để không tốn Pinata cho dữ liệu sai.
    const imageInfo = validateImage(image.data, image.mime);
    const seen = new Set<string>();
    const planned = payload.walletIds.map((walletId, idx) => {
      const wallet = ctx.store.getWallet(walletId);
      if (!wallet) throw new ValidationError({ walletIds: `Không tìm thấy ví ${walletId}` });
      if (wallet.status !== 'ready') throw new ValidationError({ walletIds: `${wallet.label} chưa sẵn sàng (cần trạng thái Sẵn sàng và có DUST)` });
      const n = idx + 1;
      const o = payload.overrides?.[walletId];
      const meta = validateTokenMeta({
        name: o?.name ?? applyTemplate(payload.template.name, n),
        symbol: o?.symbol ?? applyTemplate(payload.template.symbol, n),
        decimals: payload.template.decimals,
        amount: payload.template.amount,
      });
      if (seen.has(meta.symbol)) throw new ValidationError({ symbol: `Symbol ${meta.symbol} bị trùng trong lô. Thêm {n} vào symbol để mỗi ví một symbol riêng` });
      seen.add(meta.symbol);
      return { wallet, meta };
    });

    const pin = await ctx.ipfs.pinImage(image.data, `token-${imageInfo.sha256.slice(0, 8)}.${imageInfo.ext}`, imageInfo.mime);
    const created: TokenRecord[] = planned.map(({ wallet, meta }) => {
      const record: TokenRecord = {
        id: randomUUID(),
        walletId: wallet.id,
        name: meta.name,
        symbol: meta.symbol,
        decimals: meta.decimals,
        amountWhole: meta.amount,
        baseUnits: toBaseUnits(meta.amount, meta.decimals).toString(),
        imageUri: pin.uri,
        imageGatewayUrl: pin.gatewayUrl,
        imageSha256: imageInfo.sha256,
        encryptedOwnerSecret: vault().encrypt(randomBytes(32).toString('hex')),
        contractAddress: null,
        tokenColor: null,
        deployTxId: null,
        mintTxId: null,
        status: 'queued',
        failedStep: null,
        message: null,
        createdAt: Date.now(),
      };
      ctx.store.insertToken(record);
      return record;
    });
    for (const t of created) engine().enqueueToken(t.id);
    return reply.status(201).send(created.map(toPublicToken));
  });

  // Các kết nối SSE đang mở; đóng hết khi tắt app để app.close() không bị treo.
  const sseClients = new Set<ServerResponse>();
  app.addHook('preClose', async () => {
    for (const res of sseClients) res.end();
    sseClients.clear();
  });

  app.get('/api/events', (req, reply) => {
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    res.write(': connected\n\n');
    sseClients.add(res);
    const send = (chunk: string) => {
      if (!res.writableEnded && !res.destroyed) res.write(chunk);
    };
    const onChange = (e: unknown) => send(`data: ${JSON.stringify(e)}\n\n`);
    ctx.session.bus.on('change', onChange);
    const ping = setInterval(() => send(': ping\n\n'), 25_000);
    ping.unref();
    req.raw.on('close', () => {
      clearInterval(ping);
      ctx.session.bus.off('change', onChange);
      sseClients.delete(res);
    });
  });

  if (ctx.webDir && existsSync(resolve(ctx.webDir, 'index.html'))) {
    await app.register(fastifyStatic, { root: resolve(ctx.webDir), wildcard: false });
    app.setNotFoundHandler((req, reply) =>
      req.url.startsWith('/api/') ? fail(reply, 404, 'Không tìm thấy') : reply.sendFile('index.html'),
    );
  }
  return app;
}
