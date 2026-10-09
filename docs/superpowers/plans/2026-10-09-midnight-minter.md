# Midnight Minter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Một app web chạy local để tạo nhiều ví Midnight (tự sinh seedphrase, cấp tNIGHT, sinh DUST), rồi với mỗi ví deploy một contract token riêng và mint X token có đủ metadata (name, symbol, decimals, số lượng, ảnh IPFS); xem token theo từng ví.

**Architecture:** Backend Node 22 + TypeScript (Fastify) giữ ví, hàng đợi tuần tự và SQLite (seed mã hóa AES-256-GCM). Engine chỉ nói chuyện với blockchain qua interface `Chain` (có bản thật dùng wallet-sdk + midnight-js, và bản giả để test). Contract Compact biên dịch trong WSL. Giao diện React + Vite gọi REST và nhận cập nhật qua SSE.

**Tech Stack:** Node 22, TypeScript, Fastify 5, better-sqlite3, zod, vitest, React 18 + Vite, `@midnightntwrk/wallet-sdk` 1.2.0, `@midnight-ntwrk/midnight-js-*` 4.1.1, `compact-runtime` 0.16.0, `ledger-v8` 8.1.0, Compact compiler 0.31.1 (WSL Ubuntu), Docker `midnightntwrk/proof-server:8.0.3`, Pinata (IPFS).

**Spec:** `docs/superpowers/specs/2026-10-09-midnight-minter-design.md`

## Global Constraints

- Node >= 22; `package.json` có `"type": "module"` (thư mục `managed/` do Compact sinh ra là ES module).
- Mạng mặc định `NETWORK=preprod`; đổi sang `preview` chỉ bằng biến môi trường, không sửa code.
- Phiên bản ghim đúng: `@midnightntwrk/wallet-sdk` 1.2.0; `@midnight-ntwrk/midnight-js-*` 4.1.1; `compact-runtime` 0.16.0; `ledger-v8` 8.1.0; compiler `compact compile +0.31.1`; proof server `8.0.3`. Không dùng `@midnight-ntwrk/wallet-sdk-facade@4.0.1` và không dùng `latest`.
- Lệnh `compact` trên Windows là `C:\Windows\System32\compact.exe` (nén NTFS). Compiler Compact thật chỉ gọi qua `wsl -d Ubuntu -- ...`.
- Name 1–64 ký tự (và không quá 200 byte UTF-8); symbol 1–12 ký tự chữ/số in hoa; decimals nguyên 0–18; số lượng nguyên dương, `số lượng × 10^decimals` phải ≤ 18446744073709551615 (Uint<64>); ảnh PNG/JPEG/WEBP tối đa 5 MB.
- Seed lưu mã hóa AES-256-GCM, khóa sinh bằng scrypt từ mật khẩu chủ; mnemonic và seed không bao giờ xuất hiện trong response danh sách, log hay SSE.
- Backend chỉ lắng nghe `127.0.0.1`. `.env`, `data/`, `managed/` bị git-ignore. Khóa Blockfrost/Pinata chỉ ở `.env`, không vào frontend.
- Hàng đợi chạy **tuần tự** (mỗi lúc một job). Faucet có captcha: **không** tự động hóa faucet; tNIGHT vào ví tổng bằng tay, ví con được cấp bằng giao dịch chuyển từ ví tổng.
- tNIGHT có 6 chữ số thập phân (`NIGHT_DECIMALS = 6`), DUST có 15 (`DUST_DECIMALS = 15`). Số dư lưu và truyền dưới dạng chuỗi số nguyên (đơn vị nhỏ nhất).
- Thông báo cho người dùng bằng tiếng Việt.
- Ngoài phạm vi kế hoạch này: phát event MIP-0018 (metadata nằm trong ledger của contract, xem Task 5), nhập CSV, mainnet, chuyển token giữa các ví.

## Review Focus

Những tình huống spec không nói rõ nhưng dễ làm hỏng app; mỗi dòng có test ở task ghi trong ngoặc.

1. Số lượng nhân `10^decimals` vượt Uint<64>, hoặc số lượng 0/âm/số thập phân phải bị từ chối bằng thông báo rõ (Task 3).
2. Ảnh giả mạo: đuôi/mime là PNG nhưng nội dung không phải; ảnh quá 5 MB; ảnh rỗng (Task 3).
3. Tên/symbol dùng ký tự tiếng Việt nhiều byte, hoặc sinh từ mẫu `{n}` vượt 12 ký tự, hoặc trùng symbol trong cùng một lô (Task 3, Task 11).
4. App bị tắt giữa chừng khi contract đã deploy nhưng chưa mint: chạy lại không được deploy lần hai và không được mint hai lần (Task 9, Task 10).
5. Ví tổng không đủ tNIGHT hoặc chưa sẵn sàng: ví con phải báo đúng lý do và có thể thử lại, không treo (Task 10).
6. Response danh sách ví/token không bao giờ chứa mnemonic, `encryptedMnemonic`, `encryptedOwnerSecret` (Task 11).
7. Bấm "Tạo ví" hoặc "Mint" hai lần liên tiếp không được tạo job trùng (Task 10).

## File Structure

```
midnight-minter/
├─ package.json  tsconfig.json  vitest.config.ts  vitest.live.config.ts
├─ docker-compose.yml  .env.example  README.md
├─ contracts/token.compact                  # contract token (Task 5)
├─ scripts/compile-contract.mjs             # biên dịch qua WSL (Task 5)
├─ scripts/live-wallet.ts                   # thử ví thật trên mạng (Task 7)
├─ shared/units.ts                          # formatUnits, hằng số decimals (Task 1)
├─ server/src/
│  ├─ config/networks.ts  config/env.ts     # (Task 1)
│  ├─ lib/vault.ts                          # mã hóa seed (Task 2)
│  ├─ lib/metadata.ts                       # validate token/ảnh, mẫu {n} (Task 3)
│  ├─ types.ts  db/store.ts                 # kiểu + SQLite (Task 4)
│  ├─ chain/ws-polyfill.ts                  # global WebSocket (Task 7)
│  ├─ chain/keys.ts                         # mnemonic → khóa → địa chỉ (Task 6)
│  ├─ chain/wallet-runtime.ts               # WalletFacade, DUST, chuyển NIGHT (Task 7)
│  ├─ ipfs/pinata.ts                        # upload ảnh (Task 8)
│  ├─ chain/token-contract.ts               # deploy + mint (Task 9)
│  ├─ chain/chain.ts  chain/types.ts        # adapter Chain thật + interface (Task 9/10)
│  ├─ engine/job-queue.ts  engine/engine.ts # (Task 10)
│  ├─ app.ts  index.ts                      # Fastify + khởi động (Task 11)
├─ server/test/…                            # test từng task; server/test/live/… chạy tay trên mạng thật
└─ web/  (Vite + React)                     # (Task 12–13)
```

---

### Task 1: Khung dự án, cấu hình mạng, đơn vị

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `vitest.live.config.ts`, `.env.example`, `docker-compose.yml`, `shared/units.ts`
- Create: `server/src/config/networks.ts`, `server/src/config/env.ts`
- Test: `server/test/networks.test.ts`, `server/test/units.test.ts`

**Interfaces:**
- Produces: `NetworkName`, `NetworkConfig`, `getNetworkConfig(name, {blockfrostProjectId?, proofServerUrl?})`, `loadEnv(src?)` → `AppEnv`, `formatUnits(raw, decimals)`, `NIGHT_DECIMALS`, `DUST_DECIMALS`, `shortAddr(a, head?, tail?)`.

- [ ] **Step 1: Khởi tạo git và package**

```bash
cd D:/Papasan-Sv1/midnight-minter
git init
```

Tạo `package.json`:

```json
{
  "name": "midnight-minter",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "engines": { "node": ">=22" },
  "scripts": {
    "contract:build": "node scripts/compile-contract.mjs",
    "proof:up": "docker compose up -d proof-server",
    "dev:server": "tsx watch --env-file=.env server/src/index.ts",
    "dev:web": "vite --config web/vite.config.ts",
    "build:web": "vite build --config web/vite.config.ts",
    "start": "npm run build:web && tsx --env-file=.env server/src/index.ts",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:live": "vitest run --config vitest.live.config.ts"
  }
}
```

- [ ] **Step 2: Cài phụ thuộc đúng phiên bản**

```bash
npm install --save-exact @midnightntwrk/wallet-sdk@1.2.0 @midnight-ntwrk/midnight-js-contracts@4.1.1 @midnight-ntwrk/midnight-js-indexer-public-data-provider@4.1.1 @midnight-ntwrk/midnight-js-http-client-proof-provider@4.1.1 @midnight-ntwrk/midnight-js-node-zk-config-provider@4.1.1 @midnight-ntwrk/midnight-js-level-private-state-provider@4.1.1 @midnight-ntwrk/midnight-js-network-id@4.1.1 @midnight-ntwrk/midnight-js-types@4.1.1 @midnight-ntwrk/midnight-js-utils@4.1.1 @midnight-ntwrk/midnight-js-protocol@4.1.1 @midnight-ntwrk/compact-runtime@0.16.0 @midnight-ntwrk/ledger-v8@8.1.0
npm install ws rxjs @scure/bip39 better-sqlite3 fastify @fastify/multipart @fastify/static zod
npm install -D typescript tsx vitest @types/node @types/ws @types/better-sqlite3 vite @vitejs/plugin-react react react-dom @types/react @types/react-dom
npm ls @midnight-ntwrk/compact-runtime @midnight-ntwrk/ledger-v8
```

Expected: `compact-runtime@0.16.0` và `ledger-v8@8.1.0` xuất hiện **một** phiên bản duy nhất (không có dòng `invalid` hay hai bản khác nhau).

- [ ] **Step 3: Tạo `tsconfig.json`, `vitest.config.ts`, `vitest.live.config.ts`**

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "jsx": "react-jsx",
    "types": ["node"],
    "noEmit": true,
    "resolveJsonModule": true
  },
  "include": ["server/**/*", "shared/**/*", "web/src/**/*", "scripts/**/*.ts"]
}
```

`vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['server/test/**/*.test.ts', 'web/src/**/*.test.ts'],
    exclude: ['server/test/live/**'],
    testTimeout: 30_000,
  },
});
```

`vitest.live.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['server/test/live/**/*.test.ts'],
    testTimeout: 45 * 60_000,
    hookTimeout: 45 * 60_000,
    fileParallelism: false,
  },
});
```

- [ ] **Step 4: Tạo `.env.example`, `docker-compose.yml`**

`.env.example`:

```
NETWORK=preprod
BLOCKFROST_PROJECT_ID=
PINATA_JWT=
# PROOF_SERVER_URL=http://localhost:6300
# PORT=8787
# DATA_DIR=data
# IPFS_GATEWAY=https://gateway.pinata.cloud/ipfs/
# FUND_AMOUNT=100
```

`docker-compose.yml`:

```yaml
services:
  proof-server:
    image: midnightntwrk/proof-server:8.0.3
    ports:
      - "127.0.0.1:6300:6300"
    restart: unless-stopped
```

(Image dùng entrypoint `bash -c` và biến `PORT=6300` mặc định, nên không cần `command`.)

- [ ] **Step 5: Viết test thất bại cho `shared/units.ts`**

`server/test/units.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { DUST_DECIMALS, NIGHT_DECIMALS, formatUnits, shortAddr } from '../../shared/units';

describe('formatUnits', () => {
  it('định dạng số nguyên có dấu phân cách nghìn', () => {
    expect(formatUnits('1000000000', NIGHT_DECIMALS)).toBe('1,000');
  });
  it('giữ phần thập phân và bỏ số 0 thừa', () => {
    expect(formatUnits('1500000', NIGHT_DECIMALS)).toBe('1.5');
    expect(formatUnits(123456789n, 6)).toBe('123.456789');
  });
  it('xử lý 0 và decimals = 0', () => {
    expect(formatUnits('0', 6)).toBe('0');
    expect(formatUnits('1234567', 0)).toBe('1,234,567');
  });
  it('DUST có 15 chữ số thập phân', () => {
    expect(formatUnits('300000000000000', DUST_DECIMALS)).toBe('0.3');
  });
  it('giá trị rất nhỏ không bị làm tròn về 0', () => {
    expect(formatUnits('1', DUST_DECIMALS)).toBe('0.000000000000001');
  });
});

describe('shortAddr', () => {
  it('rút gọn địa chỉ dài', () => {
    expect(shortAddr('mn_addr_preprod1abcdefghijklmnopqrstuvwxyz', 10, 4)).toBe('mn_addr_pr…wxyz');
  });
  it('giữ nguyên địa chỉ ngắn', () => {
    expect(shortAddr('abc', 10, 4)).toBe('abc');
  });
});
```

- [ ] **Step 6: Chạy test, xác nhận thất bại**

Run: `npx vitest run server/test/units.test.ts`
Expected: FAIL (không tìm thấy `shared/units`).

- [ ] **Step 7: Viết `shared/units.ts`**

```ts
export const NIGHT_DECIMALS = 6;
export const DUST_DECIMALS = 15;

export function formatUnits(raw: string | bigint, decimals: number): string {
  const value = typeof raw === 'bigint' ? raw : BigInt(raw);
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const frac = abs % base;
  const wholeStr = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const fracStr = decimals === 0 ? '' : frac.toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${negative ? '-' : ''}${wholeStr}${fracStr ? `.${fracStr}` : ''}`;
}

export function shortAddr(address: string, head = 14, tail = 8): string {
  if (address.length <= head + tail + 1) return address;
  return `${address.slice(0, head)}…${address.slice(-tail)}`;
}
```

- [ ] **Step 8: Chạy test, xác nhận đạt**

Run: `npx vitest run server/test/units.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 9: Viết test thất bại cho cấu hình mạng**

`server/test/networks.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { getNetworkConfig } from '../src/config/networks';
import { loadEnv } from '../src/config/env';

describe('getNetworkConfig', () => {
  it('preprod gắn project_id (đã mã hóa URL) vào các URL cần khóa', () => {
    const c = getNetworkConfig('preprod', { blockfrostProjectId: 'abc 123' });
    expect(c.networkId).toBe('preprod');
    expect(c.indexerHttpUrl).toBe('https://midnight-preprod.blockfrost.io/api/v0?project_id=abc%20123');
    expect(c.indexerWsUrl).toBe('wss://midnight-preprod.blockfrost.io/api/v0/ws?project_id=abc%20123');
    expect(c.relayUrl).toBe('wss://rpc.midnight-preprod.blockfrost.io?project_id=abc%20123');
    expect(c.proofServerUrl).toBe('http://localhost:6300');
    expect(c.faucetUrl).toBe('https://midnight-tmnight-preprod.nethermind.dev/');
  });

  it('preprod thiếu project_id thì báo lỗi rõ ràng', () => {
    expect(() => getNetworkConfig('preprod', {})).toThrow(/BLOCKFROST_PROJECT_ID/);
  });

  it('preview không cần khóa', () => {
    const c = getNetworkConfig('preview', {});
    expect(c.networkId).toBe('preview');
    expect(c.indexerHttpUrl).toBe('https://indexer.preview.midnight.network/api/v4/graphql');
    expect(c.indexerWsUrl).toBe('wss://indexer.preview.midnight.network/api/v4/graphql/ws');
    expect(c.relayUrl).toBe('wss://rpc.preview.midnight.network');
  });

  it('cho phép đổi địa chỉ proof server', () => {
    const c = getNetworkConfig('preview', { proofServerUrl: 'http://127.0.0.1:7000' });
    expect(c.proofServerUrl).toBe('http://127.0.0.1:7000');
  });
});

describe('loadEnv', () => {
  const base = { PINATA_JWT: 'x'.repeat(30) };
  it('dùng giá trị mặc định', () => {
    const e = loadEnv(base);
    expect(e.network).toBe('preprod');
    expect(e.port).toBe(8787);
    expect(e.fundAmount).toBe(100_000_000n);
    expect(e.ipfsGateway).toBe('https://gateway.pinata.cloud/ipfs/');
  });
  it('FUND_AMOUNT tính theo tNIGHT và đổi sang đơn vị nhỏ nhất', () => {
    expect(loadEnv({ ...base, FUND_AMOUNT: '50' }).fundAmount).toBe(50_000_000n);
  });
  it('từ chối NETWORK không hợp lệ', () => {
    expect(() => loadEnv({ ...base, NETWORK: 'mainnet' })).toThrow();
  });
  it('thiếu PINATA_JWT thì báo lỗi', () => {
    expect(() => loadEnv({})).toThrow(/PINATA_JWT/);
  });
});
```

- [ ] **Step 10: Chạy test, xác nhận thất bại**

Run: `npx vitest run server/test/networks.test.ts`
Expected: FAIL (không tìm thấy module).

- [ ] **Step 11: Viết `networks.ts` và `env.ts`**

`server/src/config/networks.ts`:

```ts
export type NetworkName = 'preprod' | 'preview';

export interface NetworkConfig {
  name: NetworkName;
  networkId: string;
  indexerHttpUrl: string;
  indexerWsUrl: string;
  relayUrl: string;
  proofServerUrl: string;
  faucetUrl: string;
}

export interface NetworkOptions {
  blockfrostProjectId?: string;
  proofServerUrl?: string;
}

export function getNetworkConfig(name: NetworkName, opts: NetworkOptions): NetworkConfig {
  const proofServerUrl = opts.proofServerUrl ?? 'http://localhost:6300';
  if (name === 'preview') {
    return {
      name,
      networkId: 'preview',
      indexerHttpUrl: 'https://indexer.preview.midnight.network/api/v4/graphql',
      indexerWsUrl: 'wss://indexer.preview.midnight.network/api/v4/graphql/ws',
      relayUrl: 'wss://rpc.preview.midnight.network',
      proofServerUrl,
      faucetUrl: 'https://midnight-tmnight-preview.nethermind.dev/',
    };
  }
  const id = opts.blockfrostProjectId?.trim();
  if (!id) throw new Error('Thiếu BLOCKFROST_PROJECT_ID trong .env (bắt buộc cho mạng preprod)');
  const key = (url: string) => `${url}?project_id=${encodeURIComponent(id)}`;
  return {
    name,
    networkId: 'preprod',
    indexerHttpUrl: key('https://midnight-preprod.blockfrost.io/api/v0'),
    indexerWsUrl: key('wss://midnight-preprod.blockfrost.io/api/v0/ws'),
    relayUrl: key('wss://rpc.midnight-preprod.blockfrost.io'),
    proofServerUrl,
    faucetUrl: 'https://midnight-tmnight-preprod.nethermind.dev/',
  };
}
```

`server/src/config/env.ts`:

```ts
import { z } from 'zod';
import { NIGHT_DECIMALS } from '../../../shared/units';
import type { NetworkName } from './networks';

const EnvSchema = z.object({
  NETWORK: z.enum(['preprod', 'preview']).default('preprod'),
  BLOCKFROST_PROJECT_ID: z.string().trim().min(1).optional(),
  PINATA_JWT: z.string({ required_error: 'Thiếu PINATA_JWT trong .env' }).trim().min(20, 'PINATA_JWT không hợp lệ'),
  PROOF_SERVER_URL: z.string().url().optional(),
  PORT: z.coerce.number().int().min(1024).max(65535).default(8787),
  DATA_DIR: z.string().min(1).default('data'),
  IPFS_GATEWAY: z.string().url().default('https://gateway.pinata.cloud/ipfs/'),
  FUND_AMOUNT: z.coerce.number().int().positive().default(100),
});

export interface AppEnv {
  network: NetworkName;
  blockfrostProjectId?: string;
  pinataJwt: string;
  proofServerUrl?: string;
  port: number;
  dataDir: string;
  ipfsGateway: string;
  /** đơn vị nhỏ nhất của tNIGHT cấp cho mỗi ví con */
  fundAmount: bigint;
}

export function loadEnv(src: Record<string, string | undefined> = process.env): AppEnv {
  const parsed = EnvSchema.safeParse(src);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.') || 'env'}: ${i.message}`).join('; ');
    throw new Error(`Cấu hình .env không hợp lệ: ${msg}`);
  }
  const e = parsed.data;
  return {
    network: e.NETWORK,
    blockfrostProjectId: e.BLOCKFROST_PROJECT_ID,
    pinataJwt: e.PINATA_JWT,
    proofServerUrl: e.PROOF_SERVER_URL,
    port: e.PORT,
    dataDir: e.DATA_DIR,
    ipfsGateway: e.IPFS_GATEWAY.endsWith('/') ? e.IPFS_GATEWAY : `${e.IPFS_GATEWAY}/`,
    fundAmount: BigInt(e.FUND_AMOUNT) * 10n ** BigInt(NIGHT_DECIMALS),
  };
}
```

- [ ] **Step 12: Chạy toàn bộ test và typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS (units + networks), typecheck không lỗi.

- [ ] **Step 13: Bổ sung `.gitignore` và commit**

`.gitignore` đã có `.env`, `node_modules/`, `data/`, `dist/`, `*.db`. Thêm các dòng sau (artifact biên dịch nặng và kho trạng thái riêng của midnight-js):

```
managed/
midnight-level-db/
```

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts vitest.live.config.ts .env.example .gitignore docker-compose.yml shared server docs
git commit -m "chore: khung dự án, cấu hình mạng và đơn vị"
```

(Không `git add .env`. Kiểm tra bằng `git status` rằng `.env` không nằm trong danh sách.)

---

### Task 2: Vault mã hóa seed

**Files:**
- Create: `server/src/lib/vault.ts`
- Test: `server/test/vault.test.ts`

**Interfaces:**
- Produces: `interface Vault { encrypt(plain: string): string; decrypt(blob: string): string }`, `makeSalt(): Buffer`, `createVault(password: string, salt: Buffer): Vault`.

- [ ] **Step 1: Viết test thất bại**

`server/test/vault.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createVault, makeSalt } from '../src/lib/vault';

describe('vault', () => {
  const salt = makeSalt();

  it('mã hóa rồi giải mã trả về đúng nội dung, kể cả tiếng Việt', () => {
    const v = createVault('mat-khau-chu-123', salt);
    const text = 'Ví số 1 — mật mã bí mật ✓';
    expect(v.decrypt(v.encrypt(text))).toBe(text);
  });

  it('mỗi lần mã hóa cho kết quả khác nhau (IV ngẫu nhiên)', () => {
    const v = createVault('mat-khau-chu-123', salt);
    expect(v.encrypt('abc')).not.toBe(v.encrypt('abc'));
  });

  it('sai mật khẩu thì giải mã thất bại với thông báo rõ', () => {
    const blob = createVault('mat-khau-chu-123', salt).encrypt('seed');
    const wrong = createVault('mat-khau-khac-456', salt);
    expect(() => wrong.decrypt(blob)).toThrow(/Sai mật khẩu chủ/);
  });

  it('dữ liệu bị sửa thì giải mã thất bại', () => {
    const v = createVault('mat-khau-chu-123', salt);
    const parts = v.encrypt('seed').split(':');
    parts[3] = Buffer.from('xxxxxxxx').toString('base64');
    expect(() => v.decrypt(parts.join(':'))).toThrow(/Sai mật khẩu chủ/);
  });

  it('chuỗi sai định dạng bị từ chối', () => {
    const v = createVault('mat-khau-chu-123', salt);
    expect(() => v.decrypt('rac')).toThrow(/không hợp lệ/);
  });

  it('mật khẩu quá ngắn bị từ chối', () => {
    expect(() => createVault('ngan', salt)).toThrow(/ít nhất 8 ký tự/);
  });

  it('cùng mật khẩu và salt giải mã được dữ liệu của phiên trước', () => {
    const blob = createVault('mat-khau-chu-123', salt).encrypt('seed');
    expect(createVault('mat-khau-chu-123', salt).decrypt(blob)).toBe('seed');
  });
});
```

- [ ] **Step 2: Chạy test, xác nhận thất bại**

Run: `npx vitest run server/test/vault.test.ts`
Expected: FAIL (không tìm thấy module).

- [ ] **Step 3: Viết `vault.ts`**

```ts
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 128 * 1024 * 1024 };

export interface Vault {
  encrypt(plain: string): string;
  decrypt(blob: string): string;
}

export function makeSalt(): Buffer {
  return randomBytes(16);
}

export function createVault(password: string, salt: Buffer): Vault {
  if (password.length < 8) throw new Error('Mật khẩu chủ phải có ít nhất 8 ký tự');
  const key = scryptSync(password, salt, 32, SCRYPT);
  return {
    encrypt(plain) {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
      return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), enc.toString('base64')].join(':');
    },
    decrypt(blob) {
      const [version, iv, tag, enc] = blob.split(':');
      if (version !== 'v1' || !iv || !tag || !enc) throw new Error('Dữ liệu mã hóa không hợp lệ');
      try {
        const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
        decipher.setAuthTag(Buffer.from(tag, 'base64'));
        return Buffer.concat([decipher.update(Buffer.from(enc, 'base64')), decipher.final()]).toString('utf8');
      } catch {
        throw new Error('Sai mật khẩu chủ hoặc dữ liệu bị hỏng');
      }
    },
  };
}
```

- [ ] **Step 4: Chạy test, xác nhận đạt**

Run: `npx vitest run server/test/vault.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/lib/vault.ts server/test/vault.test.ts
git commit -m "feat: vault mã hóa seed AES-256-GCM + scrypt"
```

---

### Task 3: Validate token, ảnh và mẫu tên

**Files:**
- Create: `server/src/lib/metadata.ts`
- Test: `server/test/metadata.test.ts`

**Interfaces:**
- Produces:
  - `class ValidationError extends Error { fields: Record<string, string> }`
  - `interface TokenMeta { name: string; symbol: string; decimals: number; amount: string }` (`amount` là số nguyên đơn vị token, chưa nhân decimals)
  - `validateTokenMeta(input: unknown): TokenMeta` (chuẩn hóa: trim, symbol viết hoa)
  - `toBaseUnits(amount: string, decimals: number): bigint` (ném `ValidationError` nếu vượt Uint64)
  - `applyTemplate(template: string, n: number): string` (thay `{n}`)
  - `validateImage(buf: Buffer, mime: string): { sha256: string; mime: string; ext: string }`
  - `MAX_U64`, `MAX_IMAGE_BYTES`

- [ ] **Step 1: Viết test thất bại**

`server/test/metadata.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  MAX_U64,
  ValidationError,
  applyTemplate,
  toBaseUnits,
  validateImage,
  validateTokenMeta,
} from '../src/lib/metadata';

const ok = { name: 'Papa Coin', symbol: 'papa', decimals: 6, amount: '1000000' };

describe('validateTokenMeta', () => {
  it('chấp nhận dữ liệu hợp lệ, trim và viết hoa symbol', () => {
    expect(validateTokenMeta({ ...ok, name: '  Papa Coin  ' })).toEqual({
      name: 'Papa Coin', symbol: 'PAPA', decimals: 6, amount: '1000000',
    });
  });

  it('báo lỗi theo từng field khi thiếu', () => {
    try {
      validateTokenMeta({});
      throw new Error('phải ném lỗi');
    } catch (e) {
      expect(e).toBeInstanceOf(ValidationError);
      const f = (e as ValidationError).fields;
      expect(Object.keys(f).sort()).toEqual(['amount', 'decimals', 'name', 'symbol']);
    }
  });

  it('từ chối name rỗng, quá 64 ký tự, hoặc quá 200 byte', () => {
    expect(() => validateTokenMeta({ ...ok, name: '   ' })).toThrow(ValidationError);
    expect(() => validateTokenMeta({ ...ok, name: 'a'.repeat(65) })).toThrow(ValidationError);
    // 60 ký tự tiếng Việt có dấu nặng ≈ 3 byte mỗi ký tự = 180 byte (hợp lệ); 64 ký tự 4 byte = 256 byte (không hợp lệ)
    expect(() => validateTokenMeta({ ...ok, name: '𝔄'.repeat(64) })).toThrow(ValidationError);
    expect(() => validateTokenMeta({ ...ok, name: 'ệ'.repeat(60) })).not.toThrow();
  });

  it('từ chối symbol sai quy tắc', () => {
    for (const symbol of ['', 'a b', 'TOOLONGSYMBOL1', 'ĐÔ', 'a-b']) {
      expect(() => validateTokenMeta({ ...ok, symbol })).toThrow(ValidationError);
    }
  });

  it('từ chối decimals ngoài 0–18 hoặc không nguyên', () => {
    for (const decimals of [-1, 19, 1.5, '6', null]) {
      expect(() => validateTokenMeta({ ...ok, decimals })).toThrow(ValidationError);
    }
  });

  it('từ chối số lượng 0, âm, thập phân, có chữ, bắt đầu bằng 0', () => {
    for (const amount of ['0', '-5', '1.5', '1e6', 'abc', '007', '', ' ']) {
      expect(() => validateTokenMeta({ ...ok, amount })).toThrow(ValidationError);
    }
  });

  it('từ chối số lượng khi nhân 10^decimals vượt Uint64', () => {
    expect(() => validateTokenMeta({ ...ok, decimals: 18, amount: '19' })).toThrow(/Uint64|giới hạn/);
    expect(() => validateTokenMeta({ ...ok, decimals: 18, amount: '18' })).not.toThrow();
  });
});

describe('toBaseUnits', () => {
  it('nhân với 10^decimals', () => {
    expect(toBaseUnits('1000000', 6)).toBe(1_000_000_000_000n);
    expect(toBaseUnits('5', 0)).toBe(5n);
  });
  it('chấp nhận đúng giá trị lớn nhất của Uint64 và từ chối lớn hơn', () => {
    expect(toBaseUnits(MAX_U64.toString(), 0)).toBe(MAX_U64);
    expect(() => toBaseUnits((MAX_U64 + 1n).toString(), 0)).toThrow(ValidationError);
  });
});

describe('applyTemplate', () => {
  it('thay mọi {n}', () => {
    expect(applyTemplate('Papa Coin #{n}', 3)).toBe('Papa Coin #3');
    expect(applyTemplate('P{n}-{n}', 12)).toBe('P12-12');
  });
  it('không có {n} thì giữ nguyên', () => {
    expect(applyTemplate('Papa', 3)).toBe('Papa');
  });
});

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([1, 0, 0, 0]), Buffer.from('WEBPVP8 ')]);

describe('validateImage', () => {
  it('nhận PNG/JPEG/WEBP đúng nội dung và tính sha256', () => {
    const r = validateImage(PNG, 'image/png');
    expect(r.ext).toBe('png');
    expect(r.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(validateImage(JPG, 'image/jpeg').ext).toBe('jpg');
    expect(validateImage(WEBP, 'image/webp').ext).toBe('webp');
  });
  it('từ chối ảnh giả: mime là PNG nhưng nội dung không phải', () => {
    expect(() => validateImage(Buffer.from('<html>hi</html>'), 'image/png')).toThrow(ValidationError);
    expect(() => validateImage(JPG, 'image/png')).toThrow(ValidationError);
  });
  it('từ chối loại không hỗ trợ, ảnh rỗng, ảnh quá 5 MB', () => {
    expect(() => validateImage(PNG, 'image/svg+xml')).toThrow(ValidationError);
    expect(() => validateImage(Buffer.alloc(0), 'image/png')).toThrow(ValidationError);
    const big = Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024)]);
    expect(() => validateImage(big, 'image/png')).toThrow(/5 MB/);
  });
});
```

- [ ] **Step 2: Chạy test, xác nhận thất bại**

Run: `npx vitest run server/test/metadata.test.ts`
Expected: FAIL (không tìm thấy module).

- [ ] **Step 3: Viết `metadata.ts`**

```ts
import { createHash } from 'node:crypto';
import { z } from 'zod';

export const MAX_U64 = 18446744073709551615n;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export class ValidationError extends Error {
  constructor(public readonly fields: Record<string, string>) {
    super(Object.values(fields).join('; '));
    this.name = 'ValidationError';
  }
}

export interface TokenMeta {
  name: string;
  symbol: string;
  decimals: number;
  /** số lượng theo đơn vị token (chưa nhân 10^decimals) */
  amount: string;
}

const Schema = z.object({
  name: z
    .string({ required_error: 'Thiếu tên token', invalid_type_error: 'Tên token không hợp lệ' })
    .trim()
    .min(1, 'Tên token không được để trống')
    .max(64, 'Tên token tối đa 64 ký tự')
    .refine((s) => Buffer.byteLength(s, 'utf8') <= 200, 'Tên token quá dài (tối đa 200 byte)'),
  symbol: z
    .string({ required_error: 'Thiếu symbol', invalid_type_error: 'Symbol không hợp lệ' })
    .trim()
    .transform((s) => s.toUpperCase())
    .pipe(z.string().regex(/^[A-Z0-9]{1,12}$/, 'Symbol gồm 1–12 chữ cái/số, không dấu, không khoảng trắng')),
  decimals: z
    .number({ required_error: 'Thiếu decimals', invalid_type_error: 'Decimals phải là số' })
    .int('Decimals phải là số nguyên')
    .min(0, 'Decimals tối thiểu 0')
    .max(18, 'Decimals tối đa 18'),
  amount: z
    .string({ required_error: 'Thiếu số lượng', invalid_type_error: 'Số lượng không hợp lệ' })
    .regex(/^[1-9][0-9]*$/, 'Số lượng phải là số nguyên dương, không có dấu phẩy hay số 0 đứng đầu'),
});

export function validateTokenMeta(input: unknown): TokenMeta {
  const parsed = Schema.safeParse(input ?? {});
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? 'form');
      fields[key] ??= issue.message;
    }
    throw new ValidationError(fields);
  }
  const meta = parsed.data;
  toBaseUnits(meta.amount, meta.decimals);
  return meta;
}

export function toBaseUnits(amount: string, decimals: number): bigint {
  const value = BigInt(amount) * 10n ** BigInt(decimals);
  if (value > MAX_U64) {
    throw new ValidationError({ amount: 'Số lượng vượt giới hạn Uint64 (18.446.744.073.709.551.615 đơn vị nhỏ nhất)' });
  }
  return value;
}

export function applyTemplate(template: string, n: number): string {
  return template.replaceAll('{n}', String(n));
}

const IMAGE_TYPES: Record<string, { ext: string; matches: (b: Buffer) => boolean }> = {
  'image/png': { ext: 'png', matches: (b) => b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  'image/jpeg': { ext: 'jpg', matches: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  'image/webp': { ext: 'webp', matches: (b) => b.length > 12 && b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP' },
};

export function validateImage(buf: Buffer, mime: string): { sha256: string; mime: string; ext: string } {
  const type = IMAGE_TYPES[mime];
  if (!type) throw new ValidationError({ image: 'Ảnh phải là PNG, JPEG hoặc WEBP' });
  if (buf.length === 0) throw new ValidationError({ image: 'File ảnh rỗng' });
  if (buf.length > MAX_IMAGE_BYTES) throw new ValidationError({ image: 'Ảnh quá lớn (tối đa 5 MB)' });
  if (!type.matches(buf)) throw new ValidationError({ image: 'Nội dung file không đúng định dạng ảnh đã chọn' });
  return { sha256: createHash('sha256').update(buf).digest('hex'), mime, ext: type.ext };
}
```

- [ ] **Step 4: Chạy test, xác nhận đạt**

Run: `npx vitest run server/test/metadata.test.ts`
Expected: PASS. Nếu test "từ chối name 𝔄 × 64" hoặc "ệ × 60" lệch, đo lại bằng `Buffer.byteLength` rồi điều chỉnh số ký tự trong test cho khớp quy tắc 200 byte (quy tắc là nguồn đúng, test chỉ minh họa).

- [ ] **Step 5: Commit**

```bash
git add server/src/lib/metadata.ts server/test/metadata.test.ts
git commit -m "feat: validate token, ảnh và mẫu tên"
```

---

### Task 4: Kiểu dữ liệu và kho SQLite

**Files:**
- Create: `server/src/types.ts`, `server/src/db/store.ts`
- Test: `server/test/store.test.ts`

**Interfaces:**
- Consumes: `NetworkName` từ Task 1.
- Produces: các kiểu `WalletKind`, `WalletStatus`, `TokenStatus`, `WalletRecord`, `TokenRecord`, `PublicWallet`, `PublicToken`, `toPublicWallet(w, tokenCount)`, `toPublicToken(t)`; `openStore(path)` → `Store` với: `getMeta/setMeta`, `insertWallet`, `getWallet`, `getTreasury`, `listWallets`, `updateWallet`, `insertToken`, `getToken`, `listTokens(walletId)`, `countTokens(walletId)`, `listIncompleteWallets()`, `listIncompleteTokens()`, `updateToken`, `close`.

- [ ] **Step 1: Viết `types.ts`**

```ts
import type { NetworkName } from './config/networks';

export type WalletKind = 'treasury' | 'child';
export type WalletStatus = 'created' | 'funding' | 'syncing' | 'dust_pending' | 'ready' | 'failed';
export type TokenStatus = 'queued' | 'deploying' | 'minting' | 'done' | 'failed';

export interface WalletRecord {
  id: string;
  label: string;
  kind: WalletKind;
  network: NetworkName;
  unshieldedAddress: string;
  encryptedMnemonic: string;
  status: WalletStatus;
  failedStep: string | null;
  message: string | null;
  /** đơn vị nhỏ nhất, dạng chuỗi số nguyên */
  nightBalance: string;
  dustBalance: string;
  createdAt: number;
}

export interface TokenRecord {
  id: string;
  walletId: string;
  name: string;
  symbol: string;
  decimals: number;
  amountWhole: string;
  baseUnits: string;
  imageUri: string;
  imageGatewayUrl: string;
  imageSha256: string;
  encryptedOwnerSecret: string;
  contractAddress: string | null;
  tokenColor: string | null;
  deployTxId: string | null;
  mintTxId: string | null;
  status: TokenStatus;
  failedStep: string | null;
  message: string | null;
  createdAt: number;
}

export type PublicWallet = Omit<WalletRecord, 'encryptedMnemonic'> & { tokenCount: number };
export type PublicToken = Omit<TokenRecord, 'encryptedOwnerSecret'>;

export function toPublicWallet(w: WalletRecord, tokenCount: number): PublicWallet {
  const { encryptedMnemonic: _omit, ...rest } = w;
  return { ...rest, tokenCount };
}

export function toPublicToken(t: TokenRecord): PublicToken {
  const { encryptedOwnerSecret: _omit, ...rest } = t;
  return rest;
}
```

- [ ] **Step 2: Viết test thất bại**

`server/test/store.test.ts`:

```ts
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
```

- [ ] **Step 3: Chạy test, xác nhận thất bại**

Run: `npx vitest run server/test/store.test.ts`
Expected: FAIL (không tìm thấy `store`).

- [ ] **Step 4: Viết `store.ts`**

```ts
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

function insertRow(db: Database.Database, table: string, rec: object) {
  const cols = Object.keys(rec).map(toSnake);
  const sql = `INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map((c) => `@${c}`).join(',')})`;
  db.prepare(sql).run(Object.fromEntries(Object.entries(rec).map(([k, v]) => [toSnake(k), v])));
}

function updateRow(db: Database.Database, table: string, id: string, patch: object, allowed: Set<string>) {
  const entries = Object.entries(patch);
  for (const [k] of entries) {
    if (!allowed.has(k)) throw new Error(`Cột ${k} không được phép cập nhật`);
  }
  if (entries.length === 0) return;
  const sets = entries.map(([k]) => `${toSnake(k)} = @${toSnake(k)}`).join(', ');
  db.prepare(`UPDATE ${table} SET ${sets} WHERE id = @id`).run({
    id,
    ...Object.fromEntries(entries.map(([k, v]) => [toSnake(k), v])),
  });
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
    insertWallet: (w) => insertRow(db, 'wallets', w),
    getWallet: (id) => one<WalletRecord>('SELECT * FROM wallets WHERE id = ?', id),
    getTreasury: () => one<WalletRecord>("SELECT * FROM wallets WHERE kind = 'treasury' LIMIT 1"),
    listWallets: () => many<WalletRecord>('SELECT * FROM wallets ORDER BY created_at ASC, rowid ASC'),
    updateWallet(id, patch) {
      updateRow(db, 'wallets', id, patch, WALLET_UPDATABLE);
      return one<WalletRecord>('SELECT * FROM wallets WHERE id = ?', id) as WalletRecord;
    },
    listIncompleteWallets: () =>
      many<WalletRecord>("SELECT * FROM wallets WHERE status NOT IN ('ready','failed') ORDER BY created_at ASC"),
    insertToken: (t) => insertRow(db, 'tokens', t),
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
```

Lưu ý: `listWallets` sắp xếp tăng dần theo `created_at`. Test ví tổng và test thứ tự dùng `createdAt` 1 và 2, khớp kỳ vọng `['b', 'a']`.

- [ ] **Step 5: Chạy test, xác nhận đạt**

Run: `npx vitest run server/test/store.test.ts`
Expected: PASS (8 tests). Nếu `better-sqlite3` báo thiếu binary cho Node 22, chạy `npm rebuild better-sqlite3` rồi chạy lại.

- [ ] **Step 6: Commit**

```bash
git add server/src/types.ts server/src/db/store.ts server/test/store.test.ts
git commit -m "feat: kiểu dữ liệu và kho SQLite"
```

---

### Task 5: Contract token (Compact) và test mô phỏng

**Files:**
- Create: `contracts/token.compact`, `scripts/compile-contract.mjs`
- Test: `server/test/contract.test.ts`

**Interfaces:**
- Produces: thư mục `managed/token/` chứa `contract/index.js` (xuất `Contract`, `ledger`), `keys/mint.prover`, `keys/mint.verifier`, `zkir/`. Constructor: `(ownerSecret: Uint8Array(32), name: string, symbol: string, decimals: bigint, imageUri: string, imageSha256: Uint8Array(32))`. Circuit `mint(sk: Uint8Array(32), amount: bigint, recipient: { bytes: Uint8Array(32) })`. Ledger đọc được: `owner, token_color, minted, token_name, token_symbol, token_decimals, image_uri, image_sha256, minted_amount`.

Ghi chú về MIP-0018: contract này lưu **toàn bộ metadata trong ledger công khai** (giao diện và indexer đọc trực tiếp từ đó). Việc phát event theo chuẩn MIP-0018 (chuẩn còn là bản nháp, module tham chiếu nằm ở repo `midnight-experiments/mip-0018`) để ngoài phạm vi, làm sau khi đọc được API module đó.

- [ ] **Step 1: Tạo `contracts/token.compact`**

```compact
pragma language_version >= 0.20;

import CompactStandardLibrary;

export ledger owner: Bytes<32>;
export ledger token_color: Bytes<32>;
export ledger minted: Boolean;
export ledger token_name: Opaque<"string">;
export ledger token_symbol: Opaque<"string">;
export ledger token_decimals: Uint<8>;
export ledger image_uri: Opaque<"string">;
export ledger image_sha256: Bytes<32>;
export ledger minted_amount: Uint<64>;

constructor(
  ownerSecret: Bytes<32>,
  name: Opaque<"string">,
  symbol: Opaque<"string">,
  decimals: Uint<8>,
  imageUri: Opaque<"string">,
  imageSha256: Bytes<32>
) {
  owner = disclose(deriveOwnerKey(ownerSecret));
  token_name = disclose(name);
  token_symbol = disclose(symbol);
  token_decimals = disclose(decimals);
  image_uri = disclose(imageUri);
  image_sha256 = disclose(imageSha256);
  minted = false;
  minted_amount = 0;
}

export circuit deriveOwnerKey(sk: Bytes<32>): Bytes<32> {
  return persistentHash<Vector<2, Bytes<32>>>([pad(32, "minter:owner:v1"), sk]);
}

export circuit mint(sk: Bytes<32>, amount: Uint<64>, recipient: UserAddress): [] {
  assert(owner == deriveOwnerKey(sk), "not authorized to mint");
  assert(!minted, "already minted");
  assert(amount > 0, "amount must be positive");
  const color = mintUnshieldedToken(
    pad(32, "minter:token:v1"),
    disclose(amount),
    right<ContractAddress, UserAddress>(disclose(recipient))
  );
  token_color = color;
  minted_amount = disclose(amount);
  minted = true;
}
```

(Đoạn này đã được biên dịch thành công bằng compiler 0.31.1 và chạy trong trình mô phỏng trước khi đưa vào kế hoạch.)

- [ ] **Step 2: Tạo `scripts/compile-contract.mjs`**

```js
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const COMPILER = '0.31.1';
const root = resolve(import.meta.dirname, '..');
const source = resolve(root, 'contracts/token.compact');
const dest = resolve(root, 'managed/token');

function run(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: 'inherit' });
  if (r.status !== 0) {
    console.error(`\nBiên dịch thất bại (mã ${r.status}).`);
    process.exit(r.status ?? 1);
  }
}

if (process.platform === 'win32') {
  // `compact` trên Windows là công cụ nén NTFS, không phải compiler. Phải chạy trong WSL.
  const toWsl = (p) => p.replace(/^([A-Za-z]):[\\/]/, (_, d) => `/mnt/${d.toLowerCase()}/`).replace(/\\/g, '/');
  const script = [
    'set -e',
    'rm -rf ~/.minter-build && mkdir -p ~/.minter-build',
    `cp '${toWsl(source)}' ~/.minter-build/token.compact`,
    'cd ~/.minter-build',
    `compact compile +${COMPILER} token.compact out`,
    `rm -rf '${toWsl(dest)}' && mkdir -p '${toWsl(dest)}'`,
    `cp -r out/. '${toWsl(dest)}'`,
  ].join(' && ');
  run('wsl', ['-d', 'Ubuntu', '--', 'bash', '-lc', script]);
} else {
  run('compact', ['compile', `+${COMPILER}`, source, dest]);
}

if (!existsSync(resolve(dest, 'contract/index.js'))) {
  console.error('Không thấy managed/token/contract/index.js sau khi biên dịch.');
  process.exit(1);
}
console.log(`\nĐã biên dịch contract vào ${dest}`);
```

- [ ] **Step 3: Biên dịch**

Run: `npm run contract:build`
Expected: in `Compiling 1 circuits:` rồi `Đã biên dịch contract vào …\managed\token`; tồn tại `managed/token/contract/index.js`, `managed/token/keys/mint.prover`, `managed/token/keys/mint.verifier`, `managed/token/zkir/mint.bzkir`.

Nếu báo `wsl` không có Ubuntu hoặc `compact: command not found`: cài compiler trong WSL bằng `curl --proto '=https' --tlsv1.2 -LsSf https://github.com/midnightntwrk/compact/releases/latest/download/compact-installer.sh | sh` rồi `compact update 0.31.1`, chạy lại.

- [ ] **Step 4: Viết test mô phỏng thất bại**

`server/test/contract.test.ts`:

```ts
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
```

- [ ] **Step 5: Chạy test**

Run: `npx vitest run server/test/contract.test.ts`
Expected: PASS (5 tests). (Bước "thất bại trước" của task này là Step 3 chưa biên dịch: nếu chạy test trước khi có `managed/`, test báo `Chưa biên dịch contract`.)

- [ ] **Step 6: Typecheck và commit**

Run: `npx tsc --noEmit`
Expected: không lỗi (file `.d.ts` sinh ra trong `managed/token/contract/` đủ kiểu).

```bash
git add contracts scripts/compile-contract.mjs server/test/contract.test.ts
git commit -m "feat: contract token Compact, script biên dịch qua WSL và test mô phỏng"
```

---

### Task 6: Khóa ví từ mnemonic

**Files:**
- Create: `server/src/chain/keys.ts`
- Test: `server/test/keys.test.ts`

**Interfaces:**
- Produces:
  - `newMnemonic(): string` (24 từ)
  - `interface WalletKeys { shielded: ledger.ZswapSecretKeys; dust: ledger.DustSecretKey; unshieldedKeystore: UnshieldedKeystore; unshieldedAddress: string; unshieldedAddressBytes: Uint8Array }`
  - `deriveKeys(mnemonic: string, networkId: string): Promise<WalletKeys>` (ném lỗi nếu mnemonic không hợp lệ)

- [ ] **Step 1: Viết test thất bại**

`server/test/keys.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { deriveKeys, newMnemonic } from '../src/chain/keys';

describe('keys', () => {
  it('sinh mnemonic 24 từ hợp lệ, mỗi lần khác nhau', () => {
    const a = newMnemonic();
    expect(a.split(' ')).toHaveLength(24);
    expect(newMnemonic()).not.toBe(a);
  });

  it('cùng mnemonic cho cùng địa chỉ (xác định)', async () => {
    const m = newMnemonic();
    const k1 = await deriveKeys(m, 'preprod');
    const k2 = await deriveKeys(m, 'preprod');
    expect(k1.unshieldedAddress).toBe(k2.unshieldedAddress);
    expect(Buffer.from(k1.unshieldedAddressBytes).equals(Buffer.from(k2.unshieldedAddressBytes))).toBe(true);
  });

  it('địa chỉ mang tiền tố đúng mạng', async () => {
    const m = newMnemonic();
    expect((await deriveKeys(m, 'preprod')).unshieldedAddress).toMatch(/^mn_addr_preprod1/);
    expect((await deriveKeys(m, 'preview')).unshieldedAddress).toMatch(/^mn_addr_preview1/);
  });

  it('địa chỉ dạng byte dài 32', async () => {
    expect((await deriveKeys(newMnemonic(), 'preprod')).unshieldedAddressBytes).toHaveLength(32);
  });

  it('hai mnemonic khác nhau cho hai địa chỉ khác nhau', async () => {
    const a = await deriveKeys(newMnemonic(), 'preprod');
    const b = await deriveKeys(newMnemonic(), 'preprod');
    expect(a.unshieldedAddress).not.toBe(b.unshieldedAddress);
  });

  it('mnemonic sai bị từ chối với thông báo tiếng Việt', async () => {
    await expect(deriveKeys('khong phai mnemonic hop le', 'preprod')).rejects.toThrow(/Seedphrase không hợp lệ/);
  });

  it('chuẩn hóa khoảng trắng thừa trong mnemonic', async () => {
    const m = newMnemonic();
    const a = await deriveKeys(m, 'preprod');
    const b = await deriveKeys(`  ${m.replaceAll(' ', '   ')}  `, 'preprod');
    expect(b.unshieldedAddress).toBe(a.unshieldedAddress);
  });
});
```

- [ ] **Step 2: Chạy test, xác nhận thất bại**

Run: `npx vitest run server/test/keys.test.ts`
Expected: FAIL (không tìm thấy module).

- [ ] **Step 3: Viết `keys.ts`**

```ts
import * as ledger from '@midnight-ntwrk/midnight-js-protocol/ledger';
import {
  HDWallet,
  Roles,
  createKeystore,
  generateMnemonicWords,
  joinMnemonicWords,
  validateMnemonic,
} from '@midnightntwrk/wallet-sdk';
import { mnemonicToSeed } from '@scure/bip39';

export type UnshieldedKeystore = ReturnType<typeof createKeystore>;

export interface WalletKeys {
  shielded: ledger.ZswapSecretKeys;
  dust: ledger.DustSecretKey;
  unshieldedKeystore: UnshieldedKeystore;
  unshieldedAddress: string;
  unshieldedAddressBytes: Uint8Array;
}

export function newMnemonic(): string {
  return joinMnemonicWords(generateMnemonicWords(256));
}

export async function deriveKeys(mnemonic: string, networkId: string): Promise<WalletKeys> {
  const normalized = mnemonic.trim().split(/\s+/).join(' ');
  if (!validateMnemonic(normalized)) throw new Error('Seedphrase không hợp lệ');
  // Seed 64 byte chuẩn BIP-39: cho cùng địa chỉ với Lace/1AM khi nhập cùng seedphrase.
  const seed = await mnemonicToSeed(normalized);
  const hd = HDWallet.fromSeed(seed);
  if (hd.type !== 'seedOk') throw new Error('Không tạo được khóa gốc từ seedphrase');
  const derived = hd.hdWallet
    .selectAccount(0)
    .selectRoles([Roles.Zswap, Roles.NightExternal, Roles.Dust])
    .deriveKeysAt(0);
  hd.hdWallet.clear();
  if (derived.type !== 'keysDerived') throw new Error('Không dẫn xuất được khóa ví');

  const keystore = createKeystore(derived.keys[Roles.NightExternal], networkId);
  const addressHex = ledger.addressFromKey(keystore.getPublicKey());
  return {
    shielded: ledger.ZswapSecretKeys.fromSeed(derived.keys[Roles.Zswap]),
    dust: ledger.DustSecretKey.fromSeed(derived.keys[Roles.Dust]),
    unshieldedKeystore: keystore,
    unshieldedAddress: keystore.getBech32Address().toString(),
    unshieldedAddressBytes: Buffer.from(addressHex, 'hex'),
  };
}
```

- [ ] **Step 4: Chạy test, xác nhận đạt**

Run: `npx vitest run server/test/keys.test.ts`
Expected: PASS (7 tests). Nếu `createKeystore` không chấp nhận `'preview'`, đọc lỗi và dùng đúng định danh mạng mà SDK yêu cầu (`getNetworkId()` sau `setNetworkId`), vì cùng giá trị được dùng ở Task 7.

- [ ] **Step 5: Commit**

```bash
git add server/src/chain/keys.ts server/test/keys.test.ts
git commit -m "feat: dẫn xuất khóa ví từ mnemonic"
```

---

### Task 7: Ví thật — khởi tạo, số dư, DUST, chuyển NIGHT

**Files:**
- Create: `server/src/chain/ws-polyfill.ts`, `server/src/chain/wallet-runtime.ts`, `scripts/live-wallet.ts`
- Test: `server/test/live/wallet.live.test.ts` (chạy tay trên mạng thật, không nằm trong `npm test`)

**Interfaces:**
- Consumes: `NetworkConfig` (Task 1), `WalletKeys` (Task 6).
- Produces:
  - `interface OpenWallet { facade: WalletFacade; keys: WalletKeys; network: NetworkConfig; close(): Promise<void> }`
  - `openWallet(network, keys): Promise<OpenWallet>`
  - `readBalances(w, sync): Promise<{ night: bigint; dust: bigint; synced: boolean }>`
  - `waitNight(w, min: bigint, timeoutMs: number): Promise<boolean>`
  - `ensureDust(w, opts?): Promise<void>` (đăng ký rồi chờ DUST > 0)
  - `transferNight(w, toBech32: string, amount: bigint): Promise<string>`

Task này nối với mạng thật nên không có unit test; nghiệm thu bằng script chạy tay và test live. Đây cũng là chỗ đo thời gian đồng bộ trên preprod để quyết định có chuyển sang preview hay không.

- [ ] **Step 1: Viết `ws-polyfill.ts`**

```ts
import { WebSocket } from 'ws';

// SDK ví dùng WebSocket toàn cục; Node 22 chưa có bản tương thích cho GraphQL subscription.
(globalThis as unknown as { WebSocket: unknown }).WebSocket = WebSocket;
```

- [ ] **Step 2: Viết `wallet-runtime.ts`**

```ts
import './ws-polyfill';
import * as ledger from '@midnight-ntwrk/midnight-js-protocol/ledger';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import {
  DustWallet,
  MidnightBech32m,
  NoOpTransactionHistoryStorage,
  PublicKey,
  ShieldedWallet,
  UnshieldedAddress,
  UnshieldedWallet,
  WalletFacade,
} from '@midnightntwrk/wallet-sdk';
import * as Rx from 'rxjs';
import type { NetworkConfig } from '../config/networks';
import type { WalletKeys } from './keys';

const NIGHT = ledger.unshieldedToken().raw;

export interface OpenWallet {
  facade: WalletFacade;
  keys: WalletKeys;
  network: NetworkConfig;
  close(): Promise<void>;
}

export async function openWallet(network: NetworkConfig, keys: WalletKeys): Promise<OpenWallet> {
  setNetworkId(network.networkId);
  const indexerClientConnection = {
    indexerHttpUrl: network.indexerHttpUrl,
    indexerWsUrl: network.indexerWsUrl,
  };
  const shieldedConfig = {
    networkId: network.networkId,
    indexerClientConnection,
    provingServerUrl: new URL(network.proofServerUrl),
    relayURL: new URL(network.relayUrl),
  };
  const unshieldedConfig = {
    networkId: network.networkId,
    indexerClientConnection,
    txHistoryStorage: new NoOpTransactionHistoryStorage(),
  };
  const dustConfig = {
    ...shieldedConfig,
    costParameters: { additionalFeeOverhead: 300_000_000_000_000n, feeBlocksMargin: 5 },
  };

  const facade = await WalletFacade.init({
    configuration: { ...shieldedConfig, ...unshieldedConfig, ...dustConfig },
    shielded: (cfg) => ShieldedWallet(cfg).startWithSecretKeys(keys.shielded),
    unshielded: (cfg) => UnshieldedWallet(cfg).startWithPublicKey(PublicKey.fromKeyStore(keys.unshieldedKeystore)),
    dust: (cfg) => DustWallet(cfg).startWithSecretKey(keys.dust, ledger.LedgerParameters.initialParameters().dust),
  });
  await facade.start(keys.shielded, keys.dust);
  return { facade, keys, network, close: () => facade.stop() };
}

export async function readBalances(w: OpenWallet, sync: boolean) {
  const state = sync ? await w.facade.waitForSyncedState() : await Rx.firstValueFrom(w.facade.state());
  return {
    synced: state.isSynced,
    night: state.unshielded.balances[NIGHT] ?? 0n,
    dust: state.dust.balance(new Date()),
  };
}

/** Chờ cho tới khi số dư NIGHT >= min (và ví đã đồng bộ). Trả false nếu hết thời gian. */
export async function waitNight(w: OpenWallet, min: bigint, timeoutMs: number): Promise<boolean> {
  try {
    await Rx.firstValueFrom(
      w.facade.state().pipe(
        Rx.filter((s) => s.isSynced && (s.unshielded.balances[NIGHT] ?? 0n) >= min),
        Rx.timeout(timeoutMs),
      ),
    );
    return true;
  } catch (e) {
    if (e instanceof Rx.TimeoutError) return false;
    throw e;
  }
}

async function waitDust(w: OpenWallet, timeoutMs: number): Promise<void> {
  try {
    await Rx.firstValueFrom(
      w.facade.state().pipe(
        Rx.filter((s) => s.isSynced && s.dust.balance(new Date()) > 0n),
        Rx.timeout(timeoutMs),
      ),
    );
  } catch (e) {
    if (e instanceof Rx.TimeoutError) throw new Error('Chờ DUST quá lâu (hơn 20 phút). Bấm Thử lại.');
    throw e;
  }
}

export async function ensureDust(w: OpenWallet, opts: { timeoutMs?: number } = {}): Promise<void> {
  const timeoutMs = opts.timeoutMs ?? 20 * 60_000;
  const state = await w.facade.waitForSyncedState();
  const unregistered = state.unshielded.availableCoins.filter((c) => !c.meta.registeredForDustGeneration);
  if (unregistered.length > 0) {
    // Lần đăng ký đầu tự trả phí bằng DUST mà NIGHT đã sinh ra từ lúc về ví, nên phải chờ đủ.
    const { fee } = await w.facade.estimateRegistration(unregistered);
    await w.facade.waitForGeneratedDust(unregistered, fee, { timeoutMs });
    const recipe = await w.facade.registerNightUtxosForDustGeneration(
      unregistered,
      w.keys.unshieldedKeystore.getPublicKey(),
      (payload) => w.keys.unshieldedKeystore.signData(payload),
    );
    const finalized = await w.facade.finalizeRecipe(recipe);
    await w.facade.submitTransaction(finalized);
  }
  await waitDust(w, timeoutMs);
}

export async function transferNight(w: OpenWallet, toBech32: string, amount: bigint): Promise<string> {
  const receiver = MidnightBech32m.parse(toBech32).decode(UnshieldedAddress, w.network.networkId);
  const recipe = await w.facade.transferTransaction(
    [{ type: 'unshielded', outputs: [{ type: NIGHT, receiverAddress: receiver, amount }] }],
    { shieldedSecretKeys: w.keys.shielded, dustSecretKey: w.keys.dust },
    { ttl: new Date(Date.now() + 30 * 60_000) },
  );
  // Đầu vào unshielded cần chữ ký của khóa NightExternal trước khi hoàn tất.
  const signed = await w.facade.signRecipe(recipe, (payload) => w.keys.unshieldedKeystore.signData(payload));
  const finalized = await w.facade.finalizeRecipe(signed);
  return w.facade.submitTransaction(finalized);
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: không lỗi. Nếu có lỗi kiểu ở `signRecipe` / `transferTransaction`, đọc chữ ký trong `node_modules/@midnightntwrk/wallet-sdk-facade/dist/index.d.ts` (dòng khoảng 275–290) và sửa cho khớp; không dùng `as any` để che.

- [ ] **Step 4: Viết `scripts/live-wallet.ts` (công cụ thử tay)**

```ts
import { loadEnv } from '../server/src/config/env';
import { getNetworkConfig } from '../server/src/config/networks';
import { deriveKeys, newMnemonic } from '../server/src/chain/keys';
import { ensureDust, openWallet, readBalances, transferNight } from '../server/src/chain/wallet-runtime';
import { DUST_DECIMALS, NIGHT_DECIMALS, formatUnits } from '../shared/units';

const [cmd, ...args] = process.argv.slice(2);
const env = loadEnv();
const network = getNetworkConfig(env.network, {
  blockfrostProjectId: env.blockfrostProjectId,
  proofServerUrl: env.proofServerUrl,
});
const mnemonic = process.env.SPIKE_MNEMONIC;

async function main() {
  if (cmd === 'create') {
    const m = newMnemonic();
    const k = await deriveKeys(m, network.networkId);
    console.log(`Địa chỉ: ${k.unshieldedAddress}\nSPIKE_MNEMONIC="${m}"`);
    console.log(`Faucet: ${network.faucetUrl}`);
    return;
  }
  if (!mnemonic) throw new Error('Đặt biến SPIKE_MNEMONIC trước (không truyền seed qua tham số dòng lệnh)');
  const keys = await deriveKeys(mnemonic, network.networkId);
  console.log(`Mạng ${network.name} — ví ${keys.unshieldedAddress}`);
  const t0 = Date.now();
  const w = await openWallet(network, keys);
  try {
    const b = await readBalances(w, true);
    console.log(`Đồng bộ xong sau ${Math.round((Date.now() - t0) / 1000)}s`);
    console.log(`NIGHT raw=${b.night} (${formatUnits(b.night, NIGHT_DECIMALS)}); DUST raw=${b.dust} (${formatUnits(b.dust, DUST_DECIMALS)})`);
    if (cmd === 'dust') {
      await ensureDust(w);
      const after = await readBalances(w, true);
      console.log(`Sau đăng ký: DUST=${formatUnits(after.dust, DUST_DECIMALS)} (sau ${Math.round((Date.now() - t0) / 1000)}s)`);
    }
    if (cmd === 'send') {
      const [to, amountNight] = args;
      const txId = await transferNight(w, to, BigInt(amountNight) * 10n ** BigInt(NIGHT_DECIMALS));
      console.log(`Đã gửi, tx ${txId}`);
    }
  } finally {
    await w.close();
  }
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 5: Khởi động proof server và kiểm tra**

Run: `npm run proof:up` rồi `curl http://127.0.0.1:6300/health`
Expected: `{"status":"ok",…}`.

- [ ] **Step 6: Tạo ví thử và xin tNIGHT bằng tay**

Run: `npx tsx --env-file=.env scripts/live-wallet.ts create`
Expected: in địa chỉ `mn_addr_preprod1…` và dòng `SPIKE_MNEMONIC="…"`. Anh mở liên kết faucet in ra, dán địa chỉ, giải captcha và bấm xin (nhận 1000 tNIGHT). Lưu `SPIKE_MNEMONIC` vào biến môi trường của terminal (không ghi vào file đã commit).

- [ ] **Step 7: Đo đồng bộ và số dư (kiểm tra giả định về đơn vị NIGHT)**

Run (PowerShell): `$env:SPIKE_MNEMONIC="<24 từ>"; npx tsx --env-file=.env scripts/live-wallet.ts balance`
Expected: in thời gian đồng bộ và `NIGHT raw=1000000000 (1,000)` sau khi faucet gửi xong. Ghi lại:
- thời gian đồng bộ lần đầu (nếu quá khoảng 20 phút hoặc kẹt, chuyển `NETWORK=preview` trong `.env` và làm lại từ Step 6 với faucet preview);
- nếu `raw` không bằng `1000000000` thì `NIGHT_DECIMALS` không phải 6: sửa `shared/units.ts` và các test liên quan cho khớp.

- [ ] **Step 8: Đăng ký DUST**

Run: `npx tsx --env-file=.env scripts/live-wallet.ts dust`
Expected: in `Sau đăng ký: DUST=<số > 0>`. Ghi lại thời gian chờ.

- [ ] **Step 9: Chuyển tNIGHT sang ví thứ hai**

Run `create` lần nữa lấy địa chỉ ví B, rồi: `npx tsx --env-file=.env scripts/live-wallet.ts send <địa-chỉ-B> 10`
Expected: in `Đã gửi, tx …`; chạy `balance` với mnemonic của ví B sau khi tx được xác nhận thì thấy `NIGHT raw=10000000`.
Nếu `submitTransaction` báo lỗi chữ ký: bước `signRecipe` đang thiếu hoặc sai loại recipe; đối chiếu kiểu `BalancingRecipe` và sửa trong `transferNight`.

- [ ] **Step 10: Viết test live (chạy tay)**

`server/test/live/wallet.live.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { loadEnv } from '../../src/config/env';
import { getNetworkConfig } from '../../src/config/networks';
import { deriveKeys } from '../../src/chain/keys';
import { openWallet, readBalances } from '../../src/chain/wallet-runtime';

const mnemonic = process.env.SPIKE_MNEMONIC;

describe.skipIf(!mnemonic)('ví thật (live)', () => {
  it('đồng bộ ví và có tNIGHT + DUST', async () => {
    const env = loadEnv();
    const network = getNetworkConfig(env.network, { blockfrostProjectId: env.blockfrostProjectId, proofServerUrl: env.proofServerUrl });
    const w = await openWallet(network, await deriveKeys(mnemonic!, network.networkId));
    try {
      const b = await readBalances(w, true);
      expect(b.synced).toBe(true);
      expect(b.night).toBeGreaterThan(0n);
      expect(b.dust).toBeGreaterThan(0n);
    } finally {
      await w.close();
    }
  });
});
```

Run: `$env:SPIKE_MNEMONIC="<24 từ ví đã có DUST>"; npm run test:live`
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add server/src/chain scripts/live-wallet.ts server/test/live
git commit -m "feat: runtime ví thật (đồng bộ, DUST, chuyển NIGHT) và script thử tay"
```

---

### Task 8: Upload ảnh lên IPFS (Pinata)

**Files:**
- Create: `server/src/ipfs/pinata.ts`
- Test: `server/test/pinata.test.ts`

**Interfaces:**
- Produces: `createIpfs({ jwt, gateway, fetchImpl? })` → `{ pinImage(buf: Buffer, filename: string, mime: string): Promise<{ cid: string; uri: string; gatewayUrl: string }> }`; `uri` dạng `ipfs://<cid>`, `gatewayUrl` = `gateway + cid`.

- [ ] **Step 1: Viết test thất bại**

`server/test/pinata.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { createIpfs } from '../src/ipfs/pinata';

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

describe('pinata', () => {
  it('gửi multipart với Bearer JWT và trả về cid, uri, gatewayUrl', async () => {
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe('https://api.pinata.cloud/pinning/pinFileToIPFS');
      expect((init.headers as Record<string, string>).Authorization).toBe('Bearer JWT123');
      const form = init.body as FormData;
      const file = form.get('file') as File;
      expect(file.name).toBe('logo.png');
      expect(file.type).toBe('image/png');
      expect(file.size).toBe(png.length);
      return new Response(JSON.stringify({ IpfsHash: 'bafyCID', PinSize: 11, Timestamp: 'x' }), { status: 200 });
    });
    const ipfs = createIpfs({ jwt: 'JWT123', gateway: 'https://gw.example/ipfs/', fetchImpl: fetchImpl as never });
    const r = await ipfs.pinImage(png, 'logo.png', 'image/png');
    expect(r).toEqual({ cid: 'bafyCID', uri: 'ipfs://bafyCID', gatewayUrl: 'https://gw.example/ipfs/bafyCID' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('báo lỗi rõ khi Pinata trả lỗi HTTP (không lộ JWT)', async () => {
    const fetchImpl = vi.fn(async () => new Response('{"error":"INVALID_CREDENTIALS"}', { status: 401 }));
    const ipfs = createIpfs({ jwt: 'SECRETJWT', gateway: 'https://gw/ipfs/', fetchImpl: fetchImpl as never });
    const err = await ipfs.pinImage(png, 'a.png', 'image/png').catch((e) => e as Error);
    expect(err.message).toMatch(/Pinata.*401/);
    expect(err.message).not.toContain('SECRETJWT');
  });

  it('báo lỗi khi phản hồi thiếu IpfsHash', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 }));
    const ipfs = createIpfs({ jwt: 'J', gateway: 'https://gw/ipfs/', fetchImpl: fetchImpl as never });
    await expect(ipfs.pinImage(png, 'a.png', 'image/png')).rejects.toThrow(/IpfsHash/);
  });

  it('lỗi mạng được bọc bằng thông báo tiếng Việt', async () => {
    const fetchImpl = vi.fn(async () => { throw new TypeError('fetch failed'); });
    const ipfs = createIpfs({ jwt: 'J', gateway: 'https://gw/ipfs/', fetchImpl: fetchImpl as never });
    await expect(ipfs.pinImage(png, 'a.png', 'image/png')).rejects.toThrow(/Không kết nối được Pinata/);
  });
});
```

- [ ] **Step 2: Chạy test, xác nhận thất bại**

Run: `npx vitest run server/test/pinata.test.ts`
Expected: FAIL (không tìm thấy module).

- [ ] **Step 3: Viết `pinata.ts`**

```ts
export interface PinResult {
  cid: string;
  uri: string;
  gatewayUrl: string;
}

export interface Ipfs {
  pinImage(buf: Buffer, filename: string, mime: string): Promise<PinResult>;
}

export function createIpfs(opts: { jwt: string; gateway: string; fetchImpl?: typeof fetch }): Ipfs {
  const doFetch = opts.fetchImpl ?? fetch;
  const gateway = opts.gateway.endsWith('/') ? opts.gateway : `${opts.gateway}/`;
  return {
    async pinImage(buf, filename, mime) {
      const form = new FormData();
      form.append('file', new Blob([buf], { type: mime }), filename);
      form.append('pinataMetadata', JSON.stringify({ name: filename }));
      let res: Response;
      try {
        res = await doFetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
          method: 'POST',
          headers: { Authorization: `Bearer ${opts.jwt}` },
          body: form,
          signal: AbortSignal.timeout(60_000),
        });
      } catch {
        throw new Error('Không kết nối được Pinata (kiểm tra mạng hoặc thử lại)');
      }
      if (!res.ok) {
        const body = (await res.text()).slice(0, 200);
        throw new Error(`Pinata từ chối upload ảnh (HTTP ${res.status}): ${body}`);
      }
      const json = (await res.json()) as { IpfsHash?: string };
      if (!json.IpfsHash) throw new Error('Phản hồi Pinata không có IpfsHash');
      return { cid: json.IpfsHash, uri: `ipfs://${json.IpfsHash}`, gatewayUrl: `${gateway}${json.IpfsHash}` };
    },
  };
}
```

- [ ] **Step 4: Chạy test, xác nhận đạt**

Run: `npx vitest run server/test/pinata.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Thử thật một lần với ảnh nhỏ (kiểm tra khóa Pinata)**

Run:

```bash
npx tsx --env-file=.env -e "import('./server/src/ipfs/pinata.ts').then(async m=>{const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==','base64');const r=await m.createIpfs({jwt:process.env.PINATA_JWT,gateway:'https://gateway.pinata.cloud/ipfs/'}).pinImage(png,'test.png','image/png');console.log(r)})"
```

Expected: in `{ cid: 'bafy…' hoặc 'Qm…', uri: 'ipfs://…', gatewayUrl: 'https://gateway.pinata.cloud/ipfs/…' }`.

- [ ] **Step 6: Commit**

```bash
git add server/src/ipfs server/test/pinata.test.ts
git commit -m "feat: upload ảnh lên IPFS qua Pinata"
```

---

### Task 9: Deploy và mint token trên chuỗi

**Files:**
- Create: `server/src/chain/types.ts`, `server/src/chain/token-contract.ts`, `server/src/chain/chain.ts`
- Test: `server/test/live/mint.live.test.ts` (chạy tay)

**Interfaces:**
- Consumes: `OpenWallet`, `openWallet`, `readBalances`, `waitNight`, `ensureDust`, `transferNight` (Task 7); `deriveKeys` (Task 6); contract `managed/token` (Task 5).
- Produces (trong `chain/types.ts`):

```ts
export interface DeployArgs { ownerSecret: Uint8Array; name: string; symbol: string; decimals: number; imageUri: string; imageSha256Hex: string }
export interface MintArgs { contractAddress: string; ownerSecret: Uint8Array; baseUnits: bigint }
export interface ChainWallet {
  balances(sync: boolean): Promise<{ night: bigint; dust: bigint; synced: boolean }>;
  waitNight(min: bigint, timeoutMs: number): Promise<boolean>;
  ensureDust(): Promise<void>;
  transferNight(toAddress: string, amount: bigint): Promise<string>;
  deployToken(a: DeployArgs): Promise<{ contractAddress: string; txId: string }>;
  mintToken(a: MintArgs): Promise<{ txId: string; tokenColor: string; minted: bigint }>;
  close(): Promise<void>;
}
export interface Chain { open(network: NetworkConfig, mnemonic: string): Promise<ChainWallet> }
```

  `mintToken` **idempotent**: nếu ledger trên chuỗi đã `minted = true` thì không gửi giao dịch nữa, trả về `txId: 'already-minted'` cùng màu token và số lượng đã mint.

- [ ] **Step 1: Viết `chain/types.ts`**

```ts
import type { NetworkConfig } from '../config/networks';

export interface DeployArgs {
  ownerSecret: Uint8Array;
  name: string;
  symbol: string;
  decimals: number;
  imageUri: string;
  imageSha256Hex: string;
}

export interface MintArgs {
  contractAddress: string;
  ownerSecret: Uint8Array;
  baseUnits: bigint;
}

export interface ChainWallet {
  balances(sync: boolean): Promise<{ night: bigint; dust: bigint; synced: boolean }>;
  waitNight(min: bigint, timeoutMs: number): Promise<boolean>;
  ensureDust(): Promise<void>;
  transferNight(toAddress: string, amount: bigint): Promise<string>;
  deployToken(a: DeployArgs): Promise<{ contractAddress: string; txId: string }>;
  mintToken(a: MintArgs): Promise<{ txId: string; tokenColor: string; minted: bigint }>;
  close(): Promise<void>;
}

export interface Chain {
  open(network: NetworkConfig, mnemonic: string): Promise<ChainWallet>;
}
```

- [ ] **Step 2: Viết `token-contract.ts`**

```ts
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { deployContract, findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { CompiledContract } from '@midnight-ntwrk/midnight-js-protocol/compact-js';
import type { CoinPublicKey, EncPublicKey, FinalizedTransaction } from '@midnight-ntwrk/midnight-js-protocol/ledger';
import type { MidnightProvider, UnboundTransaction, WalletProvider } from '@midnight-ntwrk/midnight-js-types';
import { ttlOneHour } from '@midnight-ntwrk/midnight-js-utils';
import { Contract, ledger } from '../../../managed/token/contract/index.js';
import type { DeployArgs, MintArgs } from './types';
import type { OpenWallet } from './wallet-runtime';

const ZK_DIR = resolve(import.meta.dirname, '../../../managed/token');
const PRIVATE_STATE_ID = 'token';

class MinterWalletProvider implements WalletProvider, MidnightProvider {
  constructor(private readonly w: OpenWallet) {}
  getCoinPublicKey(): CoinPublicKey {
    return this.w.keys.shielded.coinPublicKey;
  }
  getEncryptionPublicKey(): EncPublicKey {
    return this.w.keys.shielded.encryptionPublicKey;
  }
  async balanceTx(tx: UnboundTransaction, ttl: Date = ttlOneHour()): Promise<FinalizedTransaction> {
    const recipe = await this.w.facade.balanceUnboundTransaction(
      tx,
      { shieldedSecretKeys: this.w.keys.shielded, dustSecretKey: this.w.keys.dust },
      { ttl },
    );
    return this.w.facade.finalizeRecipe(recipe);
  }
  submitTx(tx: FinalizedTransaction): Promise<string> {
    return this.w.facade.submitTransaction(tx);
  }
}

const compiled = CompiledContract.withCompiledFileAssets(
  CompiledContract.withVacantWitnesses(CompiledContract.make('token', Contract)),
  ZK_DIR,
);

export function buildProviders(w: OpenWallet, privateStatePassword: string) {
  const zkConfigProvider = new NodeZkConfigProvider<'mint'>(ZK_DIR);
  const walletProvider = new MinterWalletProvider(w);
  const accountId = w.keys.unshieldedAddress;
  return {
    privateStateProvider: levelPrivateStateProvider({
      privateStateStoreName: `token-private-${accountId.slice(-12)}`,
      signingKeyStoreName: `token-signing-${accountId.slice(-12)}`,
      privateStoragePasswordProvider: () => privateStatePassword,
      accountId,
    }),
    publicDataProvider: indexerPublicDataProvider(w.network.indexerHttpUrl, w.network.indexerWsUrl),
    zkConfigProvider,
    proofProvider: httpClientProofProvider(w.network.proofServerUrl, zkConfigProvider),
    walletProvider,
    midnightProvider: walletProvider,
  };
}

/** Mật khẩu kho trạng thái riêng của midnight-js: dẫn xuất ổn định từ seed ví, đủ độ phức tạp. */
export function privateStatePasswordFor(w: OpenWallet): string {
  return `Pk-${createHash('sha256').update(w.keys.unshieldedAddress).digest('hex').slice(0, 24)}`;
}

export async function readTokenLedger(w: OpenWallet, contractAddress: string) {
  const providers = buildProviders(w, privateStatePasswordFor(w));
  const state = await providers.publicDataProvider.queryContractState(contractAddress);
  if (!state) throw new Error('Không tìm thấy contract trên chuỗi (có thể giao dịch deploy chưa được xác nhận)');
  return ledger(state.data);
}

export async function deployToken(w: OpenWallet, a: DeployArgs): Promise<{ contractAddress: string; txId: string }> {
  const providers = buildProviders(w, privateStatePasswordFor(w));
  const deployed = await deployContract(providers, {
    compiledContract: compiled,
    privateStateId: PRIVATE_STATE_ID,
    initialPrivateState: {},
    args: [a.ownerSecret, a.name, a.symbol, BigInt(a.decimals), a.imageUri, Buffer.from(a.imageSha256Hex, 'hex')],
  });
  return {
    contractAddress: deployed.deployTxData.public.contractAddress,
    txId: deployed.deployTxData.public.txId,
  };
}

export async function mintToken(
  w: OpenWallet,
  a: MintArgs,
): Promise<{ txId: string; tokenColor: string; minted: bigint }> {
  const before = await readTokenLedger(w, a.contractAddress);
  // Idempotent: nếu lần trước đã mint thành công nhưng app tắt trước khi ghi DB thì không mint lại.
  if (before.minted) {
    return { txId: 'already-minted', tokenColor: Buffer.from(before.token_color).toString('hex'), minted: before.minted_amount };
  }
  const providers = buildProviders(w, privateStatePasswordFor(w));
  const found = await findDeployedContract(providers, {
    contractAddress: a.contractAddress,
    compiledContract: compiled,
    privateStateId: PRIVATE_STATE_ID,
    initialPrivateState: {},
  });
  const result = await found.callTx.mint(a.ownerSecret, a.baseUnits, { bytes: w.keys.unshieldedAddressBytes });
  const after = await readTokenLedger(w, a.contractAddress);
  if (!after.minted || after.minted_amount !== a.baseUnits) {
    throw new Error('Đã gửi giao dịch mint nhưng ledger trên chuỗi chưa phản ánh đúng số lượng');
  }
  return { txId: result.public.txId, tokenColor: Buffer.from(after.token_color).toString('hex'), minted: after.minted_amount };
}
```

- [ ] **Step 3: Viết `chain.ts` (adapter thật)**

```ts
import type { NetworkConfig } from '../config/networks';
import { deriveKeys } from './keys';
import { deployToken, mintToken } from './token-contract';
import type { Chain, ChainWallet } from './types';
import { ensureDust, openWallet, readBalances, transferNight, waitNight } from './wallet-runtime';

export const realChain: Chain = {
  async open(network: NetworkConfig, mnemonic: string): Promise<ChainWallet> {
    const keys = await deriveKeys(mnemonic, network.networkId);
    const w = await openWallet(network, keys);
    return {
      balances: (sync) => readBalances(w, sync),
      waitNight: (min, timeoutMs) => waitNight(w, min, timeoutMs),
      ensureDust: () => ensureDust(w),
      transferNight: (to, amount) => transferNight(w, to, amount),
      deployToken: (a) => deployToken(w, a),
      mintToken: (a) => mintToken(w, a),
      close: () => w.close(),
    };
  },
};
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: không lỗi. Nếu `deployed.deployTxData.public.txId` hoặc `result.public.txId` bị báo thiếu thuộc tính, mở `node_modules/@midnight-ntwrk/midnight-js-types/dist/midnight-types.d.ts` (interface `FinalizedTxData`, có `txId`) và sửa đường dẫn trường cho khớp; không ép kiểu.

- [ ] **Step 5: Viết test live (chạy tay)**

`server/test/live/mint.live.test.ts`:

```ts
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { realChain } from '../../src/chain/chain';
import { loadEnv } from '../../src/config/env';
import { getNetworkConfig } from '../../src/config/networks';

const mnemonic = process.env.SPIKE_MNEMONIC;

describe.skipIf(!mnemonic)('deploy + mint token (live)', () => {
  it('deploy contract, mint một lần, và mint lần hai không gửi giao dịch mới', async () => {
    const env = loadEnv();
    const network = getNetworkConfig(env.network, { blockfrostProjectId: env.blockfrostProjectId, proofServerUrl: env.proofServerUrl });
    const w = await realChain.open(network, mnemonic!);
    try {
      const b = await w.balances(true);
      expect(b.dust).toBeGreaterThan(0n);

      const ownerSecret = randomBytes(32);
      const dep = await w.deployToken({
        ownerSecret, name: 'Live Test Coin', symbol: 'LIVE1', decimals: 6,
        imageUri: 'ipfs://bafyTEST', imageSha256Hex: 'ab'.repeat(32),
      });
      expect(dep.contractAddress).toMatch(/^[0-9a-f]{64}$/);

      const minted = await w.mintToken({ contractAddress: dep.contractAddress, ownerSecret, baseUnits: 1_000_000_000n });
      expect(minted.minted).toBe(1_000_000_000n);
      expect(minted.tokenColor).toMatch(/^[0-9a-f]{64}$/);

      const again = await w.mintToken({ contractAddress: dep.contractAddress, ownerSecret, baseUnits: 1_000_000_000n });
      expect(again.txId).toBe('already-minted');
      expect(again.tokenColor).toBe(minted.tokenColor);
    } finally {
      await w.close();
    }
  });
});
```

- [ ] **Step 6: Chạy test live trên ví đã có DUST (từ Task 7)**

Run (PowerShell): `$env:SPIKE_MNEMONIC="<24 từ ví đã có DUST>"; npm run test:live -- mint`
Expected: PASS; mất vài phút (tạo bằng chứng ZK qua proof server). Ghi lại: tổng thời gian deploy + mint, lượng DUST tiêu hao (so `balance` trước/sau) để đánh giá số tNIGHT cần cấp cho mỗi ví con.
Nếu lỗi `Insufficient funds`/DUST không đủ: ví chưa có đủ DUST; chạy lại Task 7 Step 8 và chờ.

- [ ] **Step 7: Kiểm tra token hiện trong ví**

Mở Lace (đổi mạng sang Preprod), nhập seedphrase của ví thử. Expected: thấy token mới trong tab token unshielded với số lượng khớp (tên/ảnh có thể chưa hiển thị vì chưa có chuẩn metadata; ghi nhận hành vi này vào README).

- [ ] **Step 8: Commit**

```bash
git add server/src/chain server/test/live/mint.live.test.ts
git commit -m "feat: deploy và mint token trên chuỗi (mint idempotent)"
```

---

### Task 10: Hàng đợi và Engine (vòng đời ví, vòng đời mint)

**Files:**
- Create: `server/src/engine/job-queue.ts`, `server/src/engine/engine.ts`
- Test: `server/test/job-queue.test.ts`, `server/test/engine.test.ts`, `server/test/fake-chain.ts` (bản giả dùng cho test)

**Interfaces:**
- Consumes: `Store` (Task 4), `Vault` (Task 2), `Chain`/`ChainWallet` (Task 9), `newMnemonic`/`deriveKeys` (Task 6), `NetworkConfig` (Task 1), `formatUnits` (Task 1).
- Produces:
  - `JobQueue`: `enqueue(job: Job): boolean` (false nếu trùng khóa), `idle(): Promise<void>`; `type Job = { type: 'wallet' | 'token' | 'refresh'; id: string }`.
  - `Engine` (xem code): `createWallets(count, kind, labelPrefix?)`, `retryWallet(id)`, `refreshWallet(id)`, `enqueueToken(id)`, `resume()`, `pollWaiting()`, `idle()`, `closeAll()`; phát sự kiện `bus.emit('change', { kind: 'wallet' | 'token', id })`.
  - `EngineDeps { store; vault; chain; network; bus: EventEmitter; fundAmount: bigint; waitFundMs?: number }`.

- [ ] **Step 1: Viết test thất bại cho hàng đợi**

`server/test/job-queue.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { JobQueue } from '../src/engine/job-queue';

describe('JobQueue', () => {
  it('chạy tuần tự theo thứ tự thêm vào', async () => {
    const log: string[] = [];
    const q = new JobQueue(async (j) => {
      log.push(`start ${j.id}`);
      await new Promise((r) => setTimeout(r, 10));
      log.push(`end ${j.id}`);
    });
    q.enqueue({ type: 'wallet', id: 'a' });
    q.enqueue({ type: 'wallet', id: 'b' });
    await q.idle();
    expect(log).toEqual(['start a', 'end a', 'start b', 'end b']);
  });

  it('bỏ qua job trùng khóa khi đang chờ hoặc đang chạy', async () => {
    let runs = 0;
    const q = new JobQueue(async () => { runs++; await new Promise((r) => setTimeout(r, 20)); });
    expect(q.enqueue({ type: 'wallet', id: 'a' })).toBe(true);
    expect(q.enqueue({ type: 'wallet', id: 'a' })).toBe(false);
    await q.idle();
    expect(runs).toBe(1);
    expect(q.enqueue({ type: 'wallet', id: 'a' })).toBe(true);
    await q.idle();
    expect(runs).toBe(2);
  });

  it('job khác loại cùng id không bị coi là trùng', async () => {
    let runs = 0;
    const q = new JobQueue(async () => { runs++; });
    q.enqueue({ type: 'wallet', id: 'a' });
    q.enqueue({ type: 'refresh', id: 'a' });
    await q.idle();
    expect(runs).toBe(2);
  });

  it('một job lỗi không làm dừng hàng đợi', async () => {
    const done: string[] = [];
    const q = new JobQueue(async (j) => {
      if (j.id === 'bad') throw new Error('boom');
      done.push(j.id);
    });
    q.enqueue({ type: 'token', id: 'bad' });
    q.enqueue({ type: 'token', id: 'good' });
    await q.idle();
    expect(done).toEqual(['good']);
  });
});
```

- [ ] **Step 2: Chạy test, xác nhận thất bại**

Run: `npx vitest run server/test/job-queue.test.ts`
Expected: FAIL.

- [ ] **Step 3: Viết `job-queue.ts`**

```ts
export interface Job {
  type: 'wallet' | 'token' | 'refresh';
  id: string;
}

export class JobQueue {
  private pending: Job[] = [];
  private keys = new Set<string>();
  private running = false;
  private waiters: Array<() => void> = [];

  constructor(private readonly worker: (job: Job) => Promise<void>) {}

  enqueue(job: Job): boolean {
    const key = `${job.type}:${job.id}`;
    if (this.keys.has(key)) return false;
    this.keys.add(key);
    this.pending.push(job);
    void this.pump();
    return true;
  }

  idle(): Promise<void> {
    if (!this.running && this.pending.length === 0) return Promise.resolve();
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  private async pump(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (this.pending.length > 0) {
        const job = this.pending.shift() as Job;
        try {
          await this.worker(job);
        } catch (e) {
          console.error('Job lỗi ngoài dự kiến', job, e);
        } finally {
          this.keys.delete(`${job.type}:${job.id}`);
        }
      }
    } finally {
      this.running = false;
      for (const w of this.waiters.splice(0)) w();
    }
  }
}
```

- [ ] **Step 4: Chạy test hàng đợi, xác nhận đạt**

Run: `npx vitest run server/test/job-queue.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Viết chain giả cho test**

`server/test/fake-chain.ts`:

```ts
import { deriveKeys } from '../src/chain/keys';
import type { NetworkConfig } from '../src/config/networks';
import type { Chain, ChainWallet, DeployArgs, MintArgs } from '../src/chain/types';

export interface FakeState {
  /** số dư theo mnemonic */
  night: Map<string, bigint>;
  dust: Map<string, bigint>;
  /** contract đã deploy: địa chỉ → trạng thái */
  contracts: Map<string, { minted: boolean; amount: bigint; color: string }>;
  calls: string[];
  failOnce: Set<string>;
  opened: number;
  closed: number;
  balanceCalls: number;
}

/**
 * Chain giả. Mỗi lần `open` đăng ký địa chỉ ví → mnemonic, nên chuyển NIGHT tới một ví
 * hoạt động ngay khi ví nhận đã được mở (Engine luôn mở ví nhận trước khi ví tổng chuyển).
 */
export function makeFakeChain() {
  const state: FakeState = {
    night: new Map(), dust: new Map(), contracts: new Map(), calls: [], failOnce: new Set(),
    opened: 0, closed: 0, balanceCalls: 0,
  };
  const addrToMnemonic = new Map<string, string>();
  let seq = 0;

  const maybeFail = (name: string) => {
    if (state.failOnce.has(name)) {
      state.failOnce.delete(name);
      throw new Error(`lỗi giả lập ở ${name}`);
    }
  };

  const chain: Chain = {
    async open(network: NetworkConfig, mnemonic: string): Promise<ChainWallet> {
      state.opened++;
      addrToMnemonic.set((await deriveKeys(mnemonic, network.networkId)).unshieldedAddress, mnemonic);
      const w: ChainWallet = {
        async balances() {
          state.balanceCalls++;
          return { night: state.night.get(mnemonic) ?? 0n, dust: state.dust.get(mnemonic) ?? 0n, synced: true };
        },
        async waitNight(min) {
          return (state.night.get(mnemonic) ?? 0n) >= min;
        },
        async ensureDust() {
          state.calls.push(`ensureDust:${mnemonic}`);
          maybeFail('ensureDust');
          if ((state.night.get(mnemonic) ?? 0n) > 0n) state.dust.set(mnemonic, 5_000_000_000_000_000n);
        },
        async transferNight(to, amount) {
          state.calls.push(`transfer:${mnemonic}->${to}:${amount}`);
          maybeFail('transfer');
          state.night.set(mnemonic, (state.night.get(mnemonic) ?? 0n) - amount);
          const target = addrToMnemonic.get(to);
          if (target) state.night.set(target, (state.night.get(target) ?? 0n) + amount);
          return 'tx-transfer';
        },
        async deployToken(a: DeployArgs) {
          state.calls.push(`deploy:${a.symbol}`);
          maybeFail('deploy');
          const address = `contract-${++seq}`.padEnd(64, '0');
          state.contracts.set(address, { minted: false, amount: 0n, color: '' });
          return { contractAddress: address, txId: `tx-deploy-${seq}` };
        },
        async mintToken(a: MintArgs) {
          state.calls.push(`mint:${a.contractAddress}`);
          maybeFail('mint');
          const c = state.contracts.get(a.contractAddress);
          if (!c) throw new Error('contract không tồn tại');
          if (c.minted) return { txId: 'already-minted', tokenColor: c.color, minted: c.amount };
          c.minted = true;
          c.amount = a.baseUnits;
          c.color = `color-${a.contractAddress.slice(0, 12)}`.padEnd(64, '0');
          return { txId: `tx-mint-${seq}`, tokenColor: c.color, minted: c.amount };
        },
        async close() {
          state.closed++;
        },
      };
      return w;
    },
  };
  return { chain, state };
}
```

- [ ] **Step 6: Viết test thất bại cho Engine**

`server/test/engine.test.ts`:

```ts
import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it } from 'vitest';
import { Engine } from '../src/engine/engine';
import { openStore, type Store } from '../src/db/store';
import { createVault, makeSalt } from '../src/lib/vault';
import { getNetworkConfig } from '../src/config/networks';
import { makeFakeChain } from './fake-chain';
import type { TokenRecord } from '../src/types';

const FUND = 100_000_000n;
const network = getNetworkConfig('preview', {});

function setup() {
  const store = openStore(':memory:');
  const vault = createVault('mat-khau-chu-123', makeSalt());
  const fake = makeFakeChain();
  const bus = new EventEmitter();
  const events: Array<{ kind: string; id: string }> = [];
  bus.on('change', (e) => events.push(e));
  const engine = new Engine({ store, vault, chain: fake.chain, network, bus, fundAmount: FUND, waitFundMs: 10 });
  return { store, vault, fake, engine, events };
}

const mnemonicOf = (ctx: ReturnType<typeof setup>, id: string) =>
  ctx.vault.decrypt(ctx.store.getWallet(id)!.encryptedMnemonic);

/**
 * Job của ví chạy ngay khi tạo. Phải chờ nó xong (idle) rồi mới "xin faucet" (đặt số dư),
 * nếu không lệnh retry sẽ bị coi là trùng với job đang chạy.
 */
async function readyTreasury(ctx: ReturnType<typeof setup>, night = 1_000_000_000n) {
  const [t] = await ctx.engine.createWallets(1, 'treasury');
  await ctx.engine.idle(); // dừng ở funding, chờ faucet
  ctx.fake.state.night.set(mnemonicOf(ctx, t.id), night);
  ctx.engine.retryWallet(t.id);
  await ctx.engine.idle();
  return t.id;
}

describe('Engine — ví', () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => { ctx = setup(); });

  it('tạo ví con: mnemonic được mã hóa, địa chỉ đúng mạng, nhãn tự đánh số', async () => {
    const ws = await ctx.engine.createWallets(2, 'child');
    expect(ws.map((w) => w.label)).toEqual(['Ví 1', 'Ví 2']);
    for (const w of ws) {
      expect(w.unshieldedAddress).toMatch(/^mn_addr_preview1/);
      expect(w.encryptedMnemonic.startsWith('v1:')).toBe(true);
      expect(ctx.vault.decrypt(w.encryptedMnemonic).split(' ')).toHaveLength(24);
    }
    await ctx.engine.idle();
  });

  it('chỉ cho phép một ví tổng', async () => {
    await ctx.engine.createWallets(1, 'treasury');
    await expect(ctx.engine.createWallets(1, 'treasury')).rejects.toThrow(/đã có ví tổng/i);
  });

  it('ví tổng chưa có tNIGHT: dừng ở funding với hướng dẫn xin faucet, không báo lỗi', async () => {
    const [t] = await ctx.engine.createWallets(1, 'treasury');
    await ctx.engine.idle();
    const w = ctx.store.getWallet(t.id)!;
    expect(w.status).toBe('funding');
    expect(w.failedStep).toBeNull();
    expect(w.message).toMatch(/faucet/i);
  });

  it('ví tổng nhận tNIGHT rồi chạy hết vòng đời tới ready', async () => {
    const id = await readyTreasury(ctx);
    const w = ctx.store.getWallet(id)!;
    expect(w.status).toBe('ready');
    expect(BigInt(w.nightBalance)).toBe(1_000_000_000n);
    expect(BigInt(w.dustBalance)).toBeGreaterThan(0n);
  });

  it('ví con: ví tổng chuyển tNIGHT, sinh DUST, ready', async () => {
    const tid = await readyTreasury(ctx);
    const [c] = await ctx.engine.createWallets(1, 'child');
    await ctx.engine.idle();
    const w = ctx.store.getWallet(c.id)!;
    expect(w.status).toBe('ready');
    expect(BigInt(w.nightBalance)).toBe(FUND);
    expect(ctx.fake.state.calls.some((x) => x.includes('transfer:') && x.endsWith(`:${FUND}`))).toBe(true);
    expect(ctx.store.getWallet(tid)!.status).toBe('ready');
  });

  it('ví con khi chưa có ví tổng: chờ, không lỗi', async () => {
    const [c] = await ctx.engine.createWallets(1, 'child');
    await ctx.engine.idle();
    const w = ctx.store.getWallet(c.id)!;
    expect(w.status).toBe('funding');
    expect(w.message).toMatch(/ví tổng/i);
  });

  it('ví tổng không đủ tNIGHT: ví con failed(funding) với số cụ thể, thử lại được', async () => {
    await readyTreasury(ctx, 50_000_000n);
    const [c] = await ctx.engine.createWallets(1, 'child');
    await ctx.engine.idle();
    const failed = ctx.store.getWallet(c.id)!;
    expect(failed.status).toBe('failed');
    expect(failed.failedStep).toBe('funding');
    expect(failed.message).toMatch(/không đủ tNIGHT/);
    expect(failed.message).toContain('50');
    expect(failed.message).toContain('100');
    // xin thêm faucet rồi thử lại
    const t = ctx.store.getTreasury()!;
    ctx.fake.state.night.set(ctx.vault.decrypt(t.encryptedMnemonic), 500_000_000n);
    ctx.engine.retryWallet(c.id);
    await ctx.engine.idle();
    expect(ctx.store.getWallet(c.id)!.status).toBe('ready');
  });

  it('lỗi ở bước DUST: failed(dust_pending), retry chạy lại đúng bước đó và không chuyển tiền lần nữa', async () => {
    await readyTreasury(ctx);
    ctx.fake.state.failOnce.add('ensureDust'); // đặt trước khi tạo vì job chạy ngay
    const [c] = await ctx.engine.createWallets(1, 'child');
    await ctx.engine.idle();
    expect(ctx.store.getWallet(c.id)!.failedStep).toBe('dust_pending');
    const transfersBefore = ctx.fake.state.calls.filter((x) => x.startsWith('transfer:')).length;
    ctx.engine.retryWallet(c.id);
    await ctx.engine.idle();
    expect(ctx.store.getWallet(c.id)!.status).toBe('ready');
    expect(ctx.fake.state.calls.filter((x) => x.startsWith('transfer:')).length).toBe(transfersBefore);
  });

  it('bấm thử lại hai lần liên tiếp chỉ tạo một job', async () => {
    const [t] = await ctx.engine.createWallets(1, 'treasury');
    await ctx.engine.idle();
    const before = ctx.fake.state.balanceCalls;
    ctx.engine.retryWallet(t.id);
    ctx.engine.retryWallet(t.id);
    await ctx.engine.idle();
    expect(ctx.fake.state.balanceCalls - before).toBe(1); // mỗi lần chạy ví tổng đọc số dư đúng một lần
  });

  it('phát sự kiện change cho giao diện', async () => {
    await ctx.engine.createWallets(1, 'treasury');
    await ctx.engine.idle();
    expect(ctx.events.some((e) => e.kind === 'wallet')).toBe(true);
  });

  it('đóng bớt ví cũ khi mở quá 3 ví cùng lúc, giữ ví tổng', async () => {
    await readyTreasury(ctx);
    await ctx.engine.createWallets(4, 'child');
    await ctx.engine.idle();
    expect(ctx.fake.state.closed).toBeGreaterThan(0);
    expect(ctx.store.getTreasury()!.status).toBe('ready');
  });
});

describe('Engine — mint', () => {
  let ctx: ReturnType<typeof setup>;
  let walletId: string;
  beforeEach(async () => {
    ctx = setup();
    await readyTreasury(ctx);
    const [c] = await ctx.engine.createWallets(1, 'child');
    await ctx.engine.idle();
    expect(ctx.store.getWallet(c.id)!.status).toBe('ready');
    walletId = c.id;
  });

  const newToken = (over: Partial<TokenRecord> = {}): TokenRecord => ({
    id: 'tok1', walletId, name: 'Papa', symbol: 'PAPA', decimals: 6, amountWhole: '10', baseUnits: '10000000',
    imageUri: 'ipfs://cid', imageGatewayUrl: 'https://gw/ipfs/cid', imageSha256: 'ab'.repeat(32),
    encryptedOwnerSecret: ctx.vault.encrypt('cd'.repeat(32)),
    contractAddress: null, tokenColor: null, deployTxId: null, mintTxId: null,
    status: 'queued', failedStep: null, message: null, createdAt: Date.now(), ...over,
  });

  it('deploy rồi mint, lưu địa chỉ contract và màu token', async () => {
    ctx.store.insertToken(newToken());
    ctx.engine.enqueueToken('tok1');
    await ctx.engine.idle();
    const t = ctx.store.getToken('tok1')!;
    expect(t.status).toBe('done');
    expect(t.contractAddress).toMatch(/^contract-/);
    expect(t.tokenColor).toMatch(/^color-/);
    expect(t.deployTxId).toBeTruthy();
    expect(t.mintTxId).toBeTruthy();
  });

  it('mint lỗi: failed(minting), thử lại KHÔNG deploy lần hai', async () => {
    ctx.store.insertToken(newToken());
    ctx.fake.state.failOnce.add('mint');
    ctx.engine.enqueueToken('tok1');
    await ctx.engine.idle();
    const failed = ctx.store.getToken('tok1')!;
    expect(failed.status).toBe('failed');
    expect(failed.failedStep).toBe('minting');
    const addr = failed.contractAddress;
    expect(addr).toBeTruthy();
    const deploysBefore = ctx.fake.state.calls.filter((c) => c.startsWith('deploy:')).length;
    ctx.engine.enqueueToken('tok1');
    await ctx.engine.idle();
    expect(ctx.store.getToken('tok1')!.status).toBe('done');
    expect(ctx.store.getToken('tok1')!.contractAddress).toBe(addr);
    expect(ctx.fake.state.calls.filter((c) => c.startsWith('deploy:')).length).toBe(deploysBefore);
  });

  it('app tắt sau khi đã mint trên chuỗi nhưng chưa ghi DB: chạy lại không mint hai lần', async () => {
    ctx.store.insertToken(newToken());
    ctx.engine.enqueueToken('tok1');
    await ctx.engine.idle();
    // giả lập mất bản ghi mintTxId nhưng contract trên chuỗi đã mint
    ctx.store.updateToken('tok1', { status: 'minting', mintTxId: null, tokenColor: null });
    ctx.engine.enqueueToken('tok1');
    await ctx.engine.idle();
    const t = ctx.store.getToken('tok1')!;
    expect(t.status).toBe('done');
    expect(t.mintTxId).toBe('already-minted');
    expect(t.tokenColor).toMatch(/^color-/);
  });

  it('deploy lỗi: failed(deploying)', async () => {
    ctx.store.insertToken(newToken());
    ctx.fake.state.failOnce.add('deploy');
    ctx.engine.enqueueToken('tok1');
    await ctx.engine.idle();
    const t = ctx.store.getToken('tok1')!;
    expect(t.status).toBe('failed');
    expect(t.failedStep).toBe('deploying');
    expect(t.message).toMatch(/lỗi giả lập/);
  });

  it('ví chưa sẵn sàng: token failed với lý do rõ, không gọi chuỗi', async () => {
    const [c2] = await ctx.engine.createWallets(1, 'child');
    await ctx.engine.idle();
    ctx.store.updateWallet(c2.id, { status: 'funding' }); // giả lập ví đang cấp tiền
    ctx.store.insertToken(newToken({ id: 'tok2', walletId: c2.id }));
    ctx.engine.enqueueToken('tok2');
    await ctx.engine.idle();
    const t = ctx.store.getToken('tok2')!;
    expect(t.status).toBe('failed');
    expect(t.message).toMatch(/chưa sẵn sàng/);
    expect(ctx.fake.state.calls.some((c) => c.startsWith('deploy:'))).toBe(false);
  });

  it('ví hết DUST: báo rõ, không deploy', async () => {
    const w = ctx.store.getWallet(walletId)!;
    ctx.fake.state.dust.set(ctx.vault.decrypt(w.encryptedMnemonic), 0n);
    ctx.store.insertToken(newToken());
    ctx.engine.enqueueToken('tok1');
    await ctx.engine.idle();
    const t = ctx.store.getToken('tok1')!;
    expect(t.status).toBe('failed');
    expect(t.message).toMatch(/DUST/);
    expect(ctx.fake.state.calls.some((c) => c.startsWith('deploy:'))).toBe(false);
  });

  it('enqueueToken hai lần chỉ chạy một lần', async () => {
    ctx.store.insertToken(newToken());
    ctx.engine.enqueueToken('tok1');
    ctx.engine.enqueueToken('tok1');
    await ctx.engine.idle();
    expect(ctx.fake.state.calls.filter((c) => c.startsWith('deploy:')).length).toBe(1);
  });

  it('resume() đưa việc dở dang của lần chạy trước vào hàng đợi', async () => {
    ctx.store.insertToken(newToken({ status: 'minting' }));
    ctx.engine.resume();
    await ctx.engine.idle();
    expect(ctx.store.getToken('tok1')!.status).toBe('done');
  });
});
```

- [ ] **Step 7: Chạy test, xác nhận thất bại**

Run: `npx vitest run server/test/engine.test.ts`
Expected: FAIL (không tìm thấy `Engine`).

- [ ] **Step 8: Viết `engine.ts`**

```ts
import { randomUUID } from 'node:crypto';
import type { EventEmitter } from 'node:events';
import type { ChainWallet, Chain } from '../chain/types';
import { deriveKeys, newMnemonic } from '../chain/keys';
import type { NetworkConfig } from '../config/networks';
import type { Store } from '../db/store';
import type { Vault } from '../lib/vault';
import type { TokenRecord, WalletKind, WalletRecord, WalletStatus } from '../types';
import { NIGHT_DECIMALS, formatUnits } from '../../../shared/units';
import { JobQueue, type Job } from './job-queue';

export interface EngineDeps {
  store: Store;
  vault: Vault;
  chain: Chain;
  network: NetworkConfig;
  bus: EventEmitter;
  fundAmount: bigint;
  waitFundMs?: number;
}

type WalletStep = 'funding' | 'syncing' | 'dust_pending';
const STEPS: WalletStep[] = ['funding', 'syncing', 'dust_pending'];
const MAX_OPEN = 3;

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const night = (v: bigint) => `${formatUnits(v, NIGHT_DECIMALS)} tNIGHT`;

export class Engine {
  private readonly queue: JobQueue;
  private readonly open = new Map<string, ChainWallet>();

  constructor(private readonly d: EngineDeps) {
    this.queue = new JobQueue((job) => this.run(job));
  }

  idle() {
    return this.queue.idle();
  }

  async closeAll() {
    await this.queue.idle();
    for (const [id, w] of this.open) {
      await w.close().catch(() => undefined);
      this.open.delete(id);
    }
  }

  /** Tạo ví mới (sinh seedphrase, mã hóa, lưu) rồi đưa vào hàng đợi. */
  async createWallets(count: number, kind: WalletKind, labelPrefix = 'Ví'): Promise<WalletRecord[]> {
    if (kind === 'treasury' && this.d.store.getTreasury()) throw new Error('Đã có ví tổng');
    const existing = this.d.store.listWallets().filter((w) => w.kind === 'child').length;
    const created: WalletRecord[] = [];
    for (let i = 0; i < count; i++) {
      const mnemonic = newMnemonic();
      const keys = await deriveKeys(mnemonic, this.d.network.networkId);
      const record: WalletRecord = {
        id: randomUUID(),
        label: kind === 'treasury' ? 'Ví tổng' : `${labelPrefix} ${existing + i + 1}`,
        kind,
        network: this.d.network.name,
        unshieldedAddress: keys.unshieldedAddress,
        encryptedMnemonic: this.d.vault.encrypt(mnemonic),
        status: 'created',
        failedStep: null,
        message: null,
        nightBalance: '0',
        dustBalance: '0',
        createdAt: Date.now(),
      };
      this.d.store.insertWallet(record);
      created.push(record);
      this.emit('wallet', record.id);
      this.queue.enqueue({ type: 'wallet', id: record.id });
    }
    return created;
  }

  retryWallet(id: string) {
    this.queue.enqueue({ type: 'wallet', id });
  }

  refreshWallet(id: string) {
    this.queue.enqueue({ type: 'refresh', id });
  }

  enqueueToken(id: string) {
    this.queue.enqueue({ type: 'token', id });
  }

  /** Chạy tiếp việc dở dang sau khi mở lại app. */
  resume() {
    for (const w of this.d.store.listIncompleteWallets()) this.queue.enqueue({ type: 'wallet', id: w.id });
    for (const t of this.d.store.listIncompleteTokens()) this.queue.enqueue({ type: 'token', id: t.id });
  }

  /** Gọi định kỳ: ví đang chờ (faucet / ví tổng) được kiểm tra lại. */
  pollWaiting() {
    for (const w of this.d.store.listWallets()) {
      if (w.status === 'funding' && w.failedStep === null) this.queue.enqueue({ type: 'wallet', id: w.id });
    }
  }

  // ---------------------------------------------------------------- nội bộ

  private emit(kind: 'wallet' | 'token', id: string) {
    this.d.bus.emit('change', { kind, id });
  }

  private patchWallet(id: string, patch: Partial<WalletRecord>) {
    const w = this.d.store.updateWallet(id, patch);
    this.emit('wallet', id);
    return w;
  }

  private patchToken(id: string, patch: Partial<TokenRecord>) {
    const t = this.d.store.updateToken(id, patch);
    this.emit('token', id);
    return t;
  }

  private saveBalances(id: string, b: { night: bigint; dust: bigint }) {
    this.patchWallet(id, { nightBalance: b.night.toString(), dustBalance: b.dust.toString() });
  }

  private async getOpen(w: WalletRecord): Promise<ChainWallet> {
    const cached = this.open.get(w.id);
    if (cached) return cached;
    const opened = await this.d.chain.open(this.d.network, this.d.vault.decrypt(w.encryptedMnemonic));
    this.open.set(w.id, opened);
    await this.trim();
    return opened;
  }

  private async trim() {
    while (this.open.size > MAX_OPEN) {
      const victim = [...this.open.keys()].find((id) => this.d.store.getWallet(id)?.kind !== 'treasury');
      if (!victim) return;
      const w = this.open.get(victim) as ChainWallet;
      this.open.delete(victim);
      await w.close().catch(() => undefined);
    }
  }

  private async run(job: Job) {
    if (job.type === 'wallet') return this.runWallet(job.id);
    if (job.type === 'token') return this.runToken(job.id);
    return this.runRefresh(job.id);
  }

  private async runWallet(id: string) {
    const w = this.d.store.getWallet(id);
    if (!w || w.status === 'ready') return;
    const from: WalletStatus = w.status === 'failed' ? ((w.failedStep as WalletStatus) ?? 'funding') : w.status;
    const start = Math.max(0, STEPS.indexOf(from as WalletStep));

    for (let i = start; i < STEPS.length; i++) {
      const step = STEPS[i];
      this.patchWallet(id, { status: step, failedStep: null, message: null });
      try {
        const result = await this.runStep(step, this.d.store.getWallet(id) as WalletRecord);
        if (result === 'wait') return; // giữ nguyên status, message đã được ghi
      } catch (e) {
        this.patchWallet(id, { status: 'failed', failedStep: step, message: errMsg(e) });
        return;
      }
    }
    try {
      const cw = await this.getOpen(this.d.store.getWallet(id) as WalletRecord);
      this.saveBalances(id, await cw.balances(false));
    } catch {
      /* số dư sẽ được cập nhật ở lần làm mới sau */
    }
    this.patchWallet(id, { status: 'ready', failedStep: null, message: null });
  }

  private async runStep(step: WalletStep, w: WalletRecord): Promise<'ok' | 'wait'> {
    if (step === 'funding') return this.stepFunding(w);
    const cw = await this.getOpen(w);
    if (step === 'syncing') {
      this.saveBalances(w.id, await cw.balances(true));
      return 'ok';
    }
    await cw.ensureDust();
    this.saveBalances(w.id, await cw.balances(true));
    return 'ok';
  }

  private async stepFunding(w: WalletRecord): Promise<'ok' | 'wait'> {
    const cw = await this.getOpen(w);
    const mine = await cw.balances(true);
    this.saveBalances(w.id, mine);

    if (w.kind === 'treasury') {
      if (mine.night > 0n) return 'ok';
      this.patchWallet(w.id, {
        message: `Chờ tNIGHT từ faucet. Xin tại ${this.d.network.faucetUrl} cho địa chỉ ${w.unshieldedAddress}`,
      });
      return 'wait';
    }

    if (mine.night >= this.d.fundAmount) return 'ok';
    const treasury = this.d.store.getTreasury();
    if (!treasury || treasury.status !== 'ready') {
      this.patchWallet(w.id, { message: 'Chờ ví tổng sẵn sàng (cần có tNIGHT và DUST) để cấp tNIGHT cho ví này' });
      return 'wait';
    }
    const tw = await this.getOpen(treasury);
    const tb = await tw.balances(true);
    this.saveBalances(treasury.id, tb);
    if (tb.night < this.d.fundAmount) {
      throw new Error(
        `Ví tổng không đủ tNIGHT (còn ${night(tb.night)}, cần ${night(this.d.fundAmount)}). ` +
          'Xin thêm tNIGHT từ faucet cho ví tổng rồi bấm Thử lại.',
      );
    }
    await tw.transferNight(w.unshieldedAddress, this.d.fundAmount);
    const arrived = await cw.waitNight(this.d.fundAmount, this.d.waitFundMs ?? 10 * 60_000);
    if (!arrived) throw new Error('Đã chuyển tNIGHT nhưng ví chưa nhận được sau 10 phút. Bấm Thử lại để kiểm tra tiếp.');
    this.saveBalances(w.id, await cw.balances(true));
    return 'ok';
  }

  private async runRefresh(id: string) {
    const w = this.d.store.getWallet(id);
    if (!w) return;
    try {
      const cw = await this.getOpen(w);
      this.saveBalances(id, await cw.balances(true));
    } catch (e) {
      this.patchWallet(id, { message: `Không làm mới được số dư: ${errMsg(e)}` });
    }
  }

  private async runToken(id: string) {
    let t = this.d.store.getToken(id);
    if (!t || t.status === 'done') return;
    const w = this.d.store.getWallet(t.walletId);
    if (!w || w.status !== 'ready') {
      this.patchToken(id, { status: 'failed', failedStep: 'deploying', message: 'Ví chưa sẵn sàng (cần có DUST). Đợi ví về trạng thái Sẵn sàng rồi thử lại.' });
      return;
    }
    let step: 'deploying' | 'minting' = 'deploying';
    try {
      const cw = await this.getOpen(w);
      const b = await cw.balances(true);
      this.saveBalances(w.id, b);
      if (b.dust <= 0n) throw new Error('Ví chưa có DUST để trả phí giao dịch');
      const ownerSecret = Buffer.from(this.d.vault.decrypt(t.encryptedOwnerSecret), 'hex');

      if (!t.contractAddress) {
        t = this.patchToken(id, { status: 'deploying', failedStep: null, message: null });
        const r = await cw.deployToken({
          ownerSecret,
          name: t.name,
          symbol: t.symbol,
          decimals: t.decimals,
          imageUri: t.imageUri,
          imageSha256Hex: t.imageSha256,
        });
        t = this.patchToken(id, { contractAddress: r.contractAddress, deployTxId: r.txId });
      }

      step = 'minting';
      if (!t.mintTxId) {
        this.patchToken(id, { status: 'minting', failedStep: null, message: null });
        const r = await cw.mintToken({
          contractAddress: t.contractAddress as string,
          ownerSecret,
          baseUnits: BigInt(t.baseUnits),
        });
        t = this.patchToken(id, { mintTxId: r.txId, tokenColor: r.tokenColor });
      }
      this.patchToken(id, { status: 'done', failedStep: null, message: null });
      this.saveBalances(w.id, await cw.balances(false));
    } catch (e) {
      this.patchToken(id, { status: 'failed', failedStep: step, message: errMsg(e) });
    }
  }
}
```

- [ ] **Step 9: Chạy test Engine, xác nhận đạt**

Run: `npx vitest run server/test/engine.test.ts server/test/job-queue.test.ts`
Expected: PASS. Nếu một test về vòng đời ví lệch do thứ tự bind địa chỉ/mnemonic trong chain giả, sửa test helper `bind`/`readyTreasury` (chỉ phần thiết lập test), không đổi hành vi Engine mô tả trong spec.

- [ ] **Step 10: Typecheck và commit**

Run: `npx tsc --noEmit`
Expected: không lỗi.

```bash
git add server/src/engine server/test/job-queue.test.ts server/test/engine.test.ts server/test/fake-chain.ts
git commit -m "feat: hàng đợi tuần tự và engine vòng đời ví/mint"
```

---

### Task 11: API Fastify, SSE và khởi động

**Files:**
- Create: `server/src/app.ts`, `server/src/session.ts`, `server/src/index.ts`
- Test: `server/test/api.test.ts`

**Interfaces:**
- Consumes: `Engine` (Task 10), `Store`, `Vault`, `Ipfs` (Task 8), `validateTokenMeta`/`validateImage`/`toBaseUnits`/`applyTemplate`/`ValidationError` (Task 3), `toPublicWallet`/`toPublicToken` (Task 4).
- Produces: `createSession(opts)` quản lý trạng thái khóa/mở khóa; `buildApp(ctx)` trả về instance Fastify.

Danh sách endpoint (mọi đường dẫn dưới `/api`, trừ `status` và `unlock` đều cần đã mở khóa):

| Phương thức | Đường dẫn | Mô tả |
|---|---|---|
| GET | `/api/status` | `{ unlocked, initialized, network, faucetUrl, fundAmount }` |
| POST | `/api/unlock` | `{ password }` → mở khóa (lần đầu thì thiết lập mật khẩu chủ) |
| GET | `/api/wallets` | danh sách `PublicWallet[]` |
| POST | `/api/wallets` | `{ count: 1–50, kind?: 'child'\|'treasury' }` → `PublicWallet[]` |
| GET | `/api/wallets/:id` | `{ wallet, tokens }` |
| POST | `/api/wallets/:id/retry` | 202 |
| POST | `/api/wallets/:id/refresh` | 202 |
| POST | `/api/wallets/:id/seed` | `{ password }` → `{ mnemonic }` |
| POST | `/api/mint` | multipart: `payload` (JSON) + `image` → `PublicToken[]` |
| POST | `/api/tokens/:id/retry` | 202 |
| GET | `/api/events` | SSE, mỗi sự kiện `data: {"kind":"wallet"\|"token","id":"…"}` |

`payload` của `/api/mint`: `{ walletIds: string[], template: { name, symbol, decimals, amount }, overrides?: Record<walletId, { name?: string; symbol?: string }> }`. `name`/`symbol` trong `template` có thể chứa `{n}` (n = thứ tự trong lô, từ 1).

- [ ] **Step 1: Viết `session.ts`**

```ts
import { EventEmitter } from 'node:events';
import { Engine, type EngineDeps } from './engine/engine';
import type { Store } from './db/store';
import { createVault, makeSalt, type Vault } from './lib/vault';

const VERIFIER_PLAIN = 'minter-ok';

export interface Session {
  readonly bus: EventEmitter;
  readonly vault: Vault | null;
  readonly engine: Engine | null;
  initialized(): boolean;
  unlock(password: string): void;
  verifyPassword(password: string): boolean;
}

export function createSession(
  store: Store,
  makeEngine: (vault: Vault, bus: EventEmitter) => Engine,
): Session {
  const bus = new EventEmitter();
  let vault: Vault | null = null;
  let engine: Engine | null = null;
  let timer: NodeJS.Timeout | null = null;

  return {
    bus,
    get vault() { return vault; },
    get engine() { return engine; },
    initialized: () => store.getMeta('vault_salt') !== null,
    unlock(password) {
      if (vault) return;
      const saltHex = store.getMeta('vault_salt');
      if (!saltHex) {
        const salt = makeSalt();
        const v = createVault(password, salt);
        store.setMeta('vault_salt', salt.toString('hex'));
        store.setMeta('vault_check', v.encrypt(VERIFIER_PLAIN));
        vault = v;
      } else {
        const v = createVault(password, Buffer.from(saltHex, 'hex'));
        const check = store.getMeta('vault_check') as string;
        if (v.decrypt(check) !== VERIFIER_PLAIN) throw new Error('Sai mật khẩu chủ');
        vault = v;
      }
      engine = makeEngine(vault, bus);
      engine.resume();
      timer = setInterval(() => engine?.pollWaiting(), 60_000);
      timer.unref();
    },
    verifyPassword(password) {
      const saltHex = store.getMeta('vault_salt');
      if (!saltHex) return false;
      try {
        return createVault(password, Buffer.from(saltHex, 'hex')).decrypt(store.getMeta('vault_check') as string) === VERIFIER_PLAIN;
      } catch {
        return false;
      }
    },
  };
}
```

- [ ] **Step 2: Viết test API thất bại**

`server/test/api.test.ts`:

```ts
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
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
  let pinned: number;
  let fake: ReturnType<typeof makeFakeChain>;
  let vaultOf: () => { decrypt(blob: string): string };

  beforeEach(async () => {
    pinned = 0;
    fake = makeFakeChain();
    store = openStore(':memory:');
    const ipfs: Ipfs = {
      async pinImage() { pinned++; return { cid: 'bafyCID', uri: 'ipfs://bafyCID', gatewayUrl: 'https://gw/ipfs/bafyCID' }; },
    };
    const session = createSession(store, (vault, bus) => {
      engine = new Engine({ store, vault, chain: fake.chain, network, bus, fundAmount: 100_000_000n, waitFundMs: 10 });
      return engine;
    });
    vaultOf = () => session.vault!;
    app = await buildApp({ store, session, ipfs, network, fundAmount: 100_000_000n, webDir: null });
  });
  afterEach(async () => { await app.close(); });

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

  it('retry token và ví trả về 202', async () => {
    const w1 = await readyWallet();
    expect((await app.inject({ method: 'POST', url: `/api/wallets/${w1.id}/retry` })).statusCode).toBe(202);
    expect((await app.inject({ method: 'POST', url: `/api/wallets/${w1.id}/refresh` })).statusCode).toBe(202);
    expect((await app.inject({ method: 'POST', url: '/api/tokens/khong-co/retry' })).statusCode).toBe(404);
    await engine.idle();
  });
});
```

- [ ] **Step 3: Chạy test, xác nhận thất bại**

Run: `npx vitest run server/test/api.test.ts`
Expected: FAIL (không tìm thấy `app`).

- [ ] **Step 4: Viết `app.ts`**

```ts
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
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

const fail = (reply: FastifyReply, status: number, error: string) => reply.status(status).send({ error });

const MintPayload = z.object({
  walletIds: z.array(z.string()).min(1, 'Chưa chọn ví nào').max(50, 'Tối đa 50 ví mỗi lần'),
  template: z.object({ name: z.string(), symbol: z.string(), decimals: z.number(), amount: z.string() }),
  overrides: z.record(z.object({ name: z.string().optional(), symbol: z.string().optional() })).optional(),
});

export async function buildApp(ctx: AppContext): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, bodyLimit: 8 * 1024 * 1024 });
  await app.register(fastifyMultipart, { limits: { fileSize: 5 * 1024 * 1024 + 1, files: 1, fields: 5 } });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ValidationError) return fail(reply, 400, err.message);
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    return fail(reply, status, status >= 500 ? `Lỗi máy chủ: ${err.message}` : err.message);
  });

  app.addHook('preHandler', async (req, reply) => {
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
    } catch {
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
    engine().retryWallet(id);
    return reply.status(202).send({ ok: true });
  });

  app.post('/api/wallets/:id/refresh', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!ctx.store.getWallet(id)) return fail(reply, 404, 'Không tìm thấy ví');
    engine().refreshWallet(id);
    return reply.status(202).send({ ok: true });
  });

  app.post('/api/wallets/:id/seed', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { password } = (req.body ?? {}) as { password?: unknown };
    const w = ctx.store.getWallet(id);
    if (!w) return fail(reply, 404, 'Không tìm thấy ví');
    if (typeof password !== 'string' || !ctx.session.verifyPassword(password)) return fail(reply, 401, 'Sai mật khẩu chủ');
    return { mnemonic: vault().decrypt(w.encryptedMnemonic) };
  });

  app.post('/api/tokens/:id/retry', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!ctx.store.getToken(id)) return fail(reply, 404, 'Không tìm thấy token');
    engine().enqueueToken(id);
    return reply.status(202).send({ ok: true });
  });

  app.post('/api/mint', async (req, reply) => {
    let payloadRaw: string | undefined;
    let image: { data: Buffer; mime: string; filename: string } | undefined;
    for await (const part of req.parts()) {
      if (part.type === 'file') {
        const data = await part.toBuffer();
        if (part.file.truncated) return fail(reply, 400, 'Ảnh quá lớn (tối đa 5 MB)');
        image = { data, mime: part.mimetype, filename: part.filename };
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

    const pin = await ctx.ipfs.pinImage(image.data, image.filename || `token.${imageInfo.ext}`, imageInfo.mime);
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

  app.get('/api/events', (req, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    reply.raw.write(': connected\n\n');
    const onChange = (e: unknown) => reply.raw.write(`data: ${JSON.stringify(e)}\n\n`);
    ctx.session.bus.on('change', onChange);
    const ping = setInterval(() => reply.raw.write(': ping\n\n'), 25_000);
    req.raw.on('close', () => {
      clearInterval(ping);
      ctx.session.bus.off('change', onChange);
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
```

- [ ] **Step 5: Chạy test API, xác nhận đạt**

Run: `npx vitest run server/test/api.test.ts`
Expected: PASS. Điều chỉnh nhỏ cho phép nếu lệch kỳ vọng thông báo lỗi (khớp chuỗi Việt trong test với chuỗi trong `app.ts`, giữ nguyên ý nghĩa); không nới lỏng kiểm tra bảo mật (test "không chứa mnemonic/encrypted").

- [ ] **Step 6: Viết `index.ts`**

```ts
import { resolve } from 'node:path';
import { realChain } from './chain/chain';
import { loadEnv } from './config/env';
import { getNetworkConfig } from './config/networks';
import { openStore } from './db/store';
import { Engine } from './engine/engine';
import { createIpfs } from './ipfs/pinata';
import { buildApp } from './app';
import { createSession } from './session';

const env = loadEnv();
const network = getNetworkConfig(env.network, {
  blockfrostProjectId: env.blockfrostProjectId,
  proofServerUrl: env.proofServerUrl,
});
const store = openStore(resolve(env.dataDir, 'minter.db'));
const session = createSession(
  store,
  (vault, bus) => new Engine({ store, vault, chain: realChain, network, bus, fundAmount: env.fundAmount }),
);
const app = await buildApp({
  store,
  session,
  ipfs: createIpfs({ jwt: env.pinataJwt, gateway: env.ipfsGateway }),
  network,
  fundAmount: env.fundAmount,
  webDir: resolve(import.meta.dirname, '../../web/dist'),
});

await app.listen({ host: '127.0.0.1', port: env.port });
console.log(`Midnight Minter chạy tại http://127.0.0.1:${env.port} (mạng ${network.name})`);
```

- [ ] **Step 7: Chạy toàn bộ test và typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: tất cả PASS, typecheck sạch.

- [ ] **Step 8: Khởi động thử backend**

Run: `npm run dev:server` rồi (terminal khác) `curl http://127.0.0.1:8787/api/status`
Expected: `{"unlocked":false,"initialized":false,"network":"preprod","faucetUrl":"https://midnight-tmnight-preprod.nethermind.dev/","fundAmount":"100000000"}`. Dừng server (Ctrl+C).

- [ ] **Step 9: Commit**

```bash
git add server/src/app.ts server/src/session.ts server/src/index.ts server/test/api.test.ts
git commit -m "feat: API Fastify, SSE, mở khóa và khởi động"
```

---

### Task 12: Giao diện — khung, mở khóa, danh sách ví, chi tiết ví

**Trước khi bắt đầu task này, gọi skill `frontend-design:frontend-design` (và `ui-ux-pro-max` nếu cần) để chốt phong cách; code dưới đây là cấu trúc chức năng chuẩn, phần CSS có thể được tinh chỉnh theo skill nhưng không đổi hành vi.**

**Files:**
- Create: `web/vite.config.ts`, `web/index.html`, `web/src/main.tsx`, `web/src/api.ts`, `web/src/App.tsx`, `web/src/styles.css`
- Create: `web/src/components/Unlock.tsx`, `web/src/components/WalletList.tsx`, `web/src/components/WalletDetail.tsx`, `web/src/components/TokenCard.tsx`, `web/src/components/TreasuryCard.tsx`, `web/src/components/StatusBadge.tsx`
- Create: `web/src/hooks/useLive.ts`
- Test: `web/src/lib/labels.test.ts` (nhãn trạng thái)

**Interfaces:**
- Consumes: API ở Task 11; `formatUnits`, `shortAddr`, `NIGHT_DECIMALS`, `DUST_DECIMALS` từ `shared/units`.
- Produces: `api` (client), `useLive(refetch)` (kết nối SSE, gọi `refetch` có debounce khi có sự kiện), `STATUS_LABEL`, `statusTone(status)`.

- [ ] **Step 1: `web/vite.config.ts` và `web/index.html`**

`web/vite.config.ts`:

```ts
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  root: 'web',
  plugins: [react()],
  // shared/ và server/src/types nằm ngoài root `web`, cần cho phép dev server đọc.
  server: { port: 5173, fs: { allow: ['..'] }, proxy: { '/api': 'http://127.0.0.1:8787' } },
  build: { outDir: 'dist', emptyOutDir: true },
});
```

`web/index.html`:

```html
<!doctype html>
<html lang="vi">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Midnight Minter</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 2: Test nhãn trạng thái (thất bại trước)**

`web/src/lib/labels.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { STATUS_LABEL, TOKEN_STATUS_LABEL, statusTone } from './labels';

describe('labels', () => {
  it('mọi trạng thái ví đều có nhãn tiếng Việt', () => {
    for (const s of ['created', 'funding', 'syncing', 'dust_pending', 'ready', 'failed'] as const) {
      expect(STATUS_LABEL[s]).toBeTruthy();
    }
  });
  it('mọi trạng thái token đều có nhãn', () => {
    for (const s of ['queued', 'deploying', 'minting', 'done', 'failed'] as const) {
      expect(TOKEN_STATUS_LABEL[s]).toBeTruthy();
    }
  });
  it('tông màu: ready/done là ok, failed là bad, còn lại là busy', () => {
    expect(statusTone('ready')).toBe('ok');
    expect(statusTone('done')).toBe('ok');
    expect(statusTone('failed')).toBe('bad');
    expect(statusTone('syncing')).toBe('busy');
    expect(statusTone('minting')).toBe('busy');
  });
});
```

Run: `npx vitest run web/src/lib/labels.test.ts`
Expected: FAIL (không tìm thấy `labels`).

- [ ] **Step 3: `web/src/lib/labels.ts`**

```ts
import type { TokenStatus, WalletStatus } from '../../../server/src/types';

export const STATUS_LABEL: Record<WalletStatus, string> = {
  created: 'Mới tạo',
  funding: 'Đang cấp tNIGHT',
  syncing: 'Đang đồng bộ',
  dust_pending: 'Đang sinh DUST',
  ready: 'Sẵn sàng',
  failed: 'Lỗi',
};

export const TOKEN_STATUS_LABEL: Record<TokenStatus, string> = {
  queued: 'Đang chờ',
  deploying: 'Đang deploy contract',
  minting: 'Đang mint',
  done: 'Hoàn tất',
  failed: 'Lỗi',
};

export type Tone = 'ok' | 'bad' | 'busy';

export function statusTone(status: WalletStatus | TokenStatus): Tone {
  if (status === 'ready' || status === 'done') return 'ok';
  if (status === 'failed') return 'bad';
  return 'busy';
}
```

Run: `npx vitest run web/src/lib/labels.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 4: `web/src/api.ts`**

```ts
import type { PublicToken, PublicWallet } from '../../server/src/types';

export class ApiError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
  }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  if (!res.ok) {
    let message = res.statusText;
    try {
      message = ((await res.json()) as { error?: string }).error ?? message;
    } catch {
      /* giữ statusText */
    }
    throw new ApiError(message, res.status);
  }
  return (await res.json()) as T;
}

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
});

export interface Status {
  unlocked: boolean;
  initialized: boolean;
  network: string;
  faucetUrl: string;
  fundAmount: string;
}

export interface MintPayload {
  walletIds: string[];
  template: { name: string; symbol: string; decimals: number; amount: string };
  overrides?: Record<string, { name?: string; symbol?: string }>;
}

export const api = {
  status: () => req<Status>('/api/status'),
  unlock: (password: string) => req<{ ok: true }>('/api/unlock', json('POST', { password })),
  wallets: () => req<PublicWallet[]>('/api/wallets'),
  createWallets: (count: number, kind: 'child' | 'treasury' = 'child') =>
    req<PublicWallet[]>('/api/wallets', json('POST', { count, kind })),
  wallet: (id: string) => req<{ wallet: PublicWallet; tokens: PublicToken[] }>(`/api/wallets/${id}`),
  retryWallet: (id: string) => req<{ ok: true }>(`/api/wallets/${id}/retry`, json('POST')),
  refreshWallet: (id: string) => req<{ ok: true }>(`/api/wallets/${id}/refresh`, json('POST')),
  seed: (id: string, password: string) => req<{ mnemonic: string }>(`/api/wallets/${id}/seed`, json('POST', { password })),
  retryToken: (id: string) => req<{ ok: true }>(`/api/tokens/${id}/retry`, json('POST')),
  mint(payload: MintPayload, image: File) {
    const form = new FormData();
    form.append('payload', JSON.stringify(payload));
    form.append('image', image);
    return req<PublicToken[]>('/api/mint', { method: 'POST', body: form });
  },
};
```

- [ ] **Step 5: `web/src/hooks/useLive.ts`**

```ts
import { useEffect, useRef } from 'react';

/** Kết nối SSE; mỗi khi server báo thay đổi thì gọi refetch (gộp các sự kiện dồn dập). */
export function useLive(enabled: boolean, refetch: () => void) {
  const ref = useRef(refetch);
  ref.current = refetch;
  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const es = new EventSource('/api/events');
    es.onmessage = () => {
      clearTimeout(timer);
      timer = setTimeout(() => ref.current(), 300);
    };
    return () => {
      clearTimeout(timer);
      es.close();
    };
  }, [enabled]);
}
```

- [ ] **Step 6: `main.tsx` và `App.tsx`**

`web/src/main.tsx`:

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

`web/src/App.tsx`:

```tsx
import { useCallback, useEffect, useState } from 'react';
import type { PublicToken, PublicWallet } from '../../server/src/types';
import { api, type Status } from './api';
import { Unlock } from './components/Unlock';
import { WalletList } from './components/WalletList';
import { WalletDetail } from './components/WalletDetail';
import { TreasuryCard } from './components/TreasuryCard';
import { MintPanel } from './components/MintPanel';
import { useLive } from './hooks/useLive';

type Tab = 'wallets' | 'mint';

export function App() {
  const [status, setStatus] = useState<Status | null>(null);
  const [wallets, setWallets] = useState<PublicWallet[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ wallet: PublicWallet; tokens: PublicToken[] } | null>(null);
  const [tab, setTab] = useState<Tab>('wallets');
  const [error, setError] = useState<string | null>(null);

  const unlocked = status?.unlocked ?? false;

  const loadStatus = useCallback(() => api.status().then(setStatus).catch((e) => setError(e.message)), []);
  const loadWallets = useCallback(() => api.wallets().then(setWallets).catch((e) => setError(e.message)), []);
  const loadDetail = useCallback(() => {
    if (!selectedId) return setDetail(null);
    api.wallet(selectedId).then(setDetail).catch(() => setDetail(null));
  }, [selectedId]);

  useEffect(() => { void loadStatus(); }, [loadStatus]);
  useEffect(() => { if (unlocked) void loadWallets(); }, [unlocked, loadWallets]);
  useEffect(() => { loadDetail(); }, [loadDetail]);
  useLive(unlocked, () => { void loadWallets(); loadDetail(); });

  if (!status) return <div className="center muted">{error ?? 'Đang tải…'}</div>;
  if (!unlocked) return <Unlock initialized={status.initialized} onDone={loadStatus} />;

  const treasury = wallets.find((w) => w.kind === 'treasury') ?? null;
  const children = wallets.filter((w) => w.kind === 'child');

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">◐</span>
          <span>Midnight Minter</span>
        </div>
        <nav className="tabs" aria-label="Chức năng">
          <button className={tab === 'wallets' ? 'tab active' : 'tab'} onClick={() => setTab('wallets')}>Ví</button>
          <button className={tab === 'mint' ? 'tab active' : 'tab'} onClick={() => setTab('mint')}>Mint token</button>
        </nav>
        <span className={`net net-${status.network}`}>{status.network}</span>
      </header>

      {error && <div className="banner bad" role="alert" onClick={() => setError(null)}>{error}</div>}

      <div className="body">
        <aside className="side">
          <TreasuryCard
            treasury={treasury}
            faucetUrl={status.faucetUrl}
            fundAmount={status.fundAmount}
            onChanged={loadWallets}
            onSelect={(id) => { setSelectedId(id); setTab('wallets'); }}
            onError={setError}
          />
          <WalletList
            wallets={children}
            selectedId={selectedId}
            onSelect={(id) => { setSelectedId(id); setTab('wallets'); }}
            onChanged={loadWallets}
            onError={setError}
          />
        </aside>
        <main className="main">
          {tab === 'wallets' ? (
            <WalletDetail
              data={detail && detail.wallet.id === selectedId ? detail : null}
              faucetUrl={status.faucetUrl}
              onChanged={() => { void loadWallets(); loadDetail(); }}
              onError={setError}
            />
          ) : (
            <MintPanel
              wallets={children}
              onMinted={() => { void loadWallets(); loadDetail(); }}
              onError={setError}
            />
          )}
        </main>
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Các component**

`web/src/components/StatusBadge.tsx`:

```tsx
import type { TokenStatus, WalletStatus } from '../../../server/src/types';
import { STATUS_LABEL, TOKEN_STATUS_LABEL, statusTone } from '../lib/labels';

export function StatusBadge({ status, kind = 'wallet' }: { status: WalletStatus | TokenStatus; kind?: 'wallet' | 'token' }) {
  const label = kind === 'wallet' ? STATUS_LABEL[status as WalletStatus] : TOKEN_STATUS_LABEL[status as TokenStatus];
  const tone = statusTone(status);
  return (
    <span className={`badge ${tone}`}>
      {tone === 'busy' && <span className="spin" aria-hidden="true" />}
      {label}
    </span>
  );
}
```

`web/src/components/Unlock.tsx`:

```tsx
import { useState, type FormEvent } from 'react';
import { api } from '../api';

export function Unlock({ initialized, onDone }: { initialized: boolean; onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!initialized && password !== confirm) return setError('Hai lần nhập mật khẩu không khớp');
    setBusy(true);
    try {
      await api.unlock(password);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="center">
      <form className="card unlock" onSubmit={submit}>
        <h1>Midnight Minter</h1>
        <p className="muted">
          {initialized
            ? 'Nhập mật khẩu chủ để mở khóa các ví.'
            : 'Lần đầu sử dụng: đặt mật khẩu chủ để mã hóa seedphrase của các ví. Mật khẩu này không thể khôi phục nếu quên.'}
        </p>
        <label>Mật khẩu chủ
          <input type="password" autoFocus value={password} minLength={8} required onChange={(e) => setPassword(e.target.value)} />
        </label>
        {!initialized && (
          <label>Nhập lại mật khẩu
            <input type="password" value={confirm} minLength={8} required onChange={(e) => setConfirm(e.target.value)} />
          </label>
        )}
        {error && <div className="banner bad" role="alert">{error}</div>}
        <button className="btn primary" disabled={busy}>{busy ? 'Đang mở khóa…' : initialized ? 'Mở khóa' : 'Thiết lập và mở khóa'}</button>
      </form>
    </div>
  );
}
```

`web/src/components/TreasuryCard.tsx`:

```tsx
import { useState } from 'react';
import type { PublicWallet } from '../../../server/src/types';
import { DUST_DECIMALS, NIGHT_DECIMALS, formatUnits, shortAddr } from '../../../shared/units';
import { api } from '../api';
import { StatusBadge } from './StatusBadge';

interface Props {
  treasury: PublicWallet | null;
  faucetUrl: string;
  fundAmount: string;
  onChanged: () => void;
  onSelect: (id: string) => void;
  onError: (m: string) => void;
}

export function TreasuryCard({ treasury, faucetUrl, fundAmount, onChanged, onSelect, onError }: Props) {
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  async function create() {
    setBusy(true);
    try { await api.createWallets(1, 'treasury'); onChanged(); }
    catch (e) { onError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  if (!treasury) {
    return (
      <section className="card">
        <h2>Ví tổng</h2>
        <p className="muted">
          Faucet có captcha nên không thể tự động. Tạo ví tổng, xin tNIGHT cho nó một lần bằng tay,
          rồi app tự cấp {formatUnits(fundAmount, NIGHT_DECIMALS)} tNIGHT cho từng ví con.
        </p>
        <button className="btn primary" onClick={create} disabled={busy}>Tạo ví tổng</button>
      </section>
    );
  }

  const waiting = treasury.status === 'funding' && treasury.failedStep === null;
  return (
    <section className="card">
      <div className="row between">
        <h2>Ví tổng</h2>
        <StatusBadge status={treasury.status} />
      </div>
      <button className="link" onClick={() => onSelect(treasury.id)}>{shortAddr(treasury.unshieldedAddress, 16, 8)}</button>
      <dl className="kv">
        <dt>NIGHT</dt><dd>{formatUnits(treasury.nightBalance, NIGHT_DECIMALS)}</dd>
        <dt>DUST</dt><dd>{formatUnits(treasury.dustBalance, DUST_DECIMALS)}</dd>
      </dl>
      {waiting && (
        <div className="hint">
          <p>Xin tNIGHT cho địa chỉ này (cần giải captcha):</p>
          <div className="row">
            <button
              className="btn"
              onClick={async () => { await navigator.clipboard.writeText(treasury.unshieldedAddress); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
            >{copied ? 'Đã chép' : 'Chép địa chỉ'}</button>
            <a className="btn" href={faucetUrl} target="_blank" rel="noreferrer">Mở faucet</a>
          </div>
          <p className="muted small">App tự phát hiện khi tiền về.</p>
        </div>
      )}
      {treasury.status === 'failed' && (
        <div className="hint bad">
          <p>{treasury.message}</p>
          <button className="btn" onClick={() => api.retryWallet(treasury.id).then(onChanged)}>Thử lại</button>
        </div>
      )}
    </section>
  );
}
```

`web/src/components/WalletList.tsx`:

```tsx
import { useState } from 'react';
import type { PublicWallet } from '../../../server/src/types';
import { DUST_DECIMALS, NIGHT_DECIMALS, formatUnits, shortAddr } from '../../../shared/units';
import { api } from '../api';
import { StatusBadge } from './StatusBadge';

interface Props {
  wallets: PublicWallet[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onChanged: () => void;
  onError: (m: string) => void;
}

export function WalletList({ wallets, selectedId, onSelect, onChanged, onError }: Props) {
  const [count, setCount] = useState(1);
  const [busy, setBusy] = useState(false);

  async function create() {
    setBusy(true);
    try { await api.createWallets(count, 'child'); onChanged(); }
    catch (e) { onError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  return (
    <section className="card grow">
      <div className="row between">
        <h2>Ví con <span className="muted">({wallets.length})</span></h2>
      </div>
      <div className="row create">
        <input
          type="number" min={1} max={50} value={count} aria-label="Số ví cần tạo"
          onChange={(e) => setCount(Math.max(1, Math.min(50, Number(e.target.value) || 1)))}
        />
        <button className="btn primary" onClick={create} disabled={busy}>
          {count === 1 ? 'Tạo ví mới' : `Tạo ${count} ví`}
        </button>
      </div>
      <ul className="wallets" role="listbox" aria-label="Danh sách ví">
        {wallets.length === 0 && <li className="muted empty">Chưa có ví nào.</li>}
        {wallets.map((w) => (
          <li key={w.id}>
            <button className={w.id === selectedId ? 'wallet selected' : 'wallet'} role="option" aria-selected={w.id === selectedId} onClick={() => onSelect(w.id)}>
              <div className="row between">
                <strong>{w.label}</strong>
                <StatusBadge status={w.status} />
              </div>
              <div className="mono small muted">{shortAddr(w.unshieldedAddress, 16, 6)}</div>
              <div className="row small">
                <span>NIGHT {formatUnits(w.nightBalance, NIGHT_DECIMALS)}</span>
                <span>DUST {formatUnits(w.dustBalance, DUST_DECIMALS).slice(0, 8)}</span>
                <span>{w.tokenCount} token</span>
              </div>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
```

`web/src/components/TokenCard.tsx`:

```tsx
import type { PublicToken } from '../../../server/src/types';
import { formatUnits, shortAddr } from '../../../shared/units';
import { api } from '../api';
import { StatusBadge } from './StatusBadge';

const Field = ({ label, value, mono }: { label: string; value: string | null; mono?: boolean }) => (
  <>
    <dt>{label}</dt>
    <dd className={mono ? 'mono' : undefined} title={value ?? undefined}>
      {value ? value : <span className="missing">Thiếu</span>}
    </dd>
  </>
);

export function TokenCard({ token, onChanged }: { token: PublicToken; onChanged: () => void }) {
  return (
    <article className="token card">
      <img className="token-img" src={token.imageGatewayUrl} alt={`Ảnh token ${token.name}`} loading="lazy" />
      <div className="token-body">
        <div className="row between">
          <h3>{token.name} <span className="muted">({token.symbol})</span></h3>
          <StatusBadge status={token.status} kind="token" />
        </div>
        <dl className="kv wide">
          <Field label="Name" value={token.name} />
          <Field label="Symbol" value={token.symbol} />
          <Field label="Decimals" value={String(token.decimals)} />
          <Field label="Số lượng" value={formatUnits(token.baseUnits, token.decimals)} />
          <Field label="Ảnh (IPFS)" value={token.imageUri} mono />
          <Field label="SHA-256 ảnh" value={token.imageSha256} mono />
          <Field label="Contract" value={token.contractAddress ? shortAddr(token.contractAddress, 14, 10) : null} mono />
          <Field label="Màu token" value={token.tokenColor ? shortAddr(token.tokenColor, 14, 10) : null} mono />
          <Field label="Tx deploy" value={token.deployTxId ? shortAddr(token.deployTxId, 12, 8) : null} mono />
          <Field label="Tx mint" value={token.mintTxId ? shortAddr(token.mintTxId, 12, 8) : null} mono />
        </dl>
        {token.status === 'failed' && (
          <div className="hint bad">
            <p>{token.message}</p>
            <button className="btn" onClick={() => api.retryToken(token.id).then(onChanged)}>Thử lại từ bước {token.failedStep === 'minting' ? 'mint' : 'deploy'}</button>
          </div>
        )}
      </div>
    </article>
  );
}
```

`web/src/components/WalletDetail.tsx`:

```tsx
import { useState } from 'react';
import type { PublicToken, PublicWallet } from '../../../server/src/types';
import { DUST_DECIMALS, NIGHT_DECIMALS, formatUnits } from '../../../shared/units';
import { api } from '../api';
import { StatusBadge } from './StatusBadge';
import { TokenCard } from './TokenCard';

interface Props {
  data: { wallet: PublicWallet; tokens: PublicToken[] } | null;
  faucetUrl: string;
  onChanged: () => void;
  onError: (m: string) => void;
}

export function WalletDetail({ data, faucetUrl, onChanged, onError }: Props) {
  const [seed, setSeed] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [password, setPassword] = useState('');

  if (!data) return <div className="card empty-state"><p className="muted">Chọn một ví ở bên trái để xem token của ví đó.</p></div>;
  const { wallet: w, tokens } = data;

  async function reveal() {
    try {
      const r = await api.seed(w.id, password);
      setSeed(r.mnemonic);
      setAsking(false);
      setPassword('');
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="stack">
      <section className="card">
        <div className="row between">
          <div>
            <h2>{w.label}</h2>
            <div className="mono small copyable" title="Địa chỉ unshielded">{w.unshieldedAddress}</div>
          </div>
          <StatusBadge status={w.status} />
        </div>
        <dl className="kv wide">
          <dt>Mạng</dt><dd>{w.network}</dd>
          <dt>NIGHT</dt><dd>{formatUnits(w.nightBalance, NIGHT_DECIMALS)}</dd>
          <dt>DUST</dt><dd>{formatUnits(w.dustBalance, DUST_DECIMALS)}</dd>
          <dt>Số token</dt><dd>{tokens.length}</dd>
        </dl>
        {w.message && w.status !== 'ready' && <div className={w.status === 'failed' ? 'hint bad' : 'hint'}><p>{w.message}</p></div>}
        <div className="row">
          <button className="btn" onClick={() => api.refreshWallet(w.id).then(onChanged)}>Làm mới số dư</button>
          {(w.status === 'failed' || w.status === 'funding') && <button className="btn" onClick={() => api.retryWallet(w.id).then(onChanged)}>Thử lại</button>}
          <button className="btn" onClick={() => (seed ? setSeed(null) : setAsking(true))}>{seed ? 'Ẩn seedphrase' : 'Xem seedphrase'}</button>
          <a className="btn" href={faucetUrl} target="_blank" rel="noreferrer">Faucet</a>
        </div>
        {asking && (
          <form className="row" onSubmit={(e) => { e.preventDefault(); void reveal(); }}>
            <input type="password" autoFocus placeholder="Mật khẩu chủ" value={password} onChange={(e) => setPassword(e.target.value)} />
            <button className="btn primary">Hiện</button>
            <button type="button" className="btn" onClick={() => { setAsking(false); setPassword(''); }}>Hủy</button>
          </form>
        )}
        {seed && (
          <div className="seed" role="note">
            <p className="small">Giữ bí mật. Ai có 24 từ này là có toàn quyền với ví.</p>
            <ol>{seed.split(' ').map((word, i) => <li key={i}>{word}</li>)}</ol>
          </div>
        )}
      </section>

      <section>
        <h2 className="section-title">Token của ví này <span className="muted">({tokens.length})</span></h2>
        {tokens.length === 0
          ? <div className="card empty-state"><p className="muted">Ví chưa có token nào. Qua tab "Mint token" để tạo.</p></div>
          : <div className="stack">{tokens.map((t) => <TokenCard key={t.id} token={t} onChanged={onChanged} />)}</div>}
      </section>
    </div>
  );
}
```

- [ ] **Step 8: `MintPanel` tạm thời (hoàn thiện ở Task 13) và `styles.css`**

Tạo `web/src/components/MintPanel.tsx` bản tối thiểu để dự án build được; Task 13 thay bằng bản đầy đủ:

```tsx
import type { PublicWallet } from '../../../server/src/types';

export function MintPanel(_: { wallets: PublicWallet[]; onMinted: () => void; onError: (m: string) => void }) {
  return <div className="card"><p className="muted">Sẽ làm ở Task 13.</p></div>;
}
```

`web/src/styles.css` (nền tối làm mặc định, có bản sáng theo hệ thống; tất cả màu là biến để skill thiết kế tinh chỉnh):

```css
:root {
  --bg: #0e1016; --panel: #161a23; --panel-2: #1c2130; --line: #272d3d;
  --text: #e8eaf2; --muted: #8b93a8; --accent: #7c6cff; --accent-ink: #fff;
  --ok: #34d399; --bad: #f87171; --busy: #fbbf24;
  --radius: 12px; --gap: 16px; --font: Inter, system-ui, 'Segoe UI', sans-serif;
  --mono: ui-monospace, 'SF Mono', 'Cascadia Code', Consolas, monospace;
}
@media (prefers-color-scheme: light) {
  :root { --bg: #f4f5f9; --panel: #fff; --panel-2: #f0f1f7; --line: #dfe2ec; --text: #161a26; --muted: #5d657a; }
}
* { box-sizing: border-box; }
html, body, #root { height: 100%; }
body { margin: 0; background: var(--bg); color: var(--text); font: 14px/1.5 var(--font); }
h1, h2, h3 { margin: 0; line-height: 1.25; }
h2 { font-size: 15px; } h3 { font-size: 15px; }
.muted { color: var(--muted); } .small { font-size: 12px; } .mono { font-family: var(--mono); word-break: break-all; }
.center { min-height: 100%; display: grid; place-items: center; padding: 16px; }
.shell { display: flex; flex-direction: column; height: 100%; }
.topbar { display: flex; align-items: center; gap: 24px; padding: 12px 20px; border-bottom: 1px solid var(--line); background: var(--panel); }
.brand { display: flex; align-items: center; gap: 8px; font-weight: 700; }
.brand-mark { color: var(--accent); font-size: 18px; }
.tabs { display: flex; gap: 4px; flex: 1; }
.tab { background: none; border: 0; color: var(--muted); padding: 8px 14px; border-radius: 8px; cursor: pointer; font: inherit; }
.tab.active { background: var(--panel-2); color: var(--text); }
.net { font-size: 12px; padding: 3px 10px; border-radius: 999px; background: var(--panel-2); color: var(--muted); text-transform: uppercase; letter-spacing: .04em; }
.body { display: grid; grid-template-columns: 360px 1fr; gap: var(--gap); padding: var(--gap); flex: 1; min-height: 0; }
.side { display: flex; flex-direction: column; gap: var(--gap); min-height: 0; }
.main { overflow-y: auto; min-width: 0; }
.stack { display: flex; flex-direction: column; gap: var(--gap); }
.card { background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); padding: 16px; display: flex; flex-direction: column; gap: 12px; }
.card.grow { flex: 1; min-height: 0; }
.empty-state { align-items: center; justify-content: center; min-height: 160px; text-align: center; }
.section-title { margin: 8px 0 12px; }
.row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; } .between { justify-content: space-between; }
.btn { background: var(--panel-2); color: var(--text); border: 1px solid var(--line); padding: 8px 14px; border-radius: 8px; cursor: pointer; font: inherit; text-decoration: none; display: inline-flex; align-items: center; }
.btn:hover { border-color: var(--accent); } .btn:disabled { opacity: .5; cursor: not-allowed; }
.btn.primary { background: var(--accent); color: var(--accent-ink); border-color: var(--accent); font-weight: 600; }
.btn:focus-visible, input:focus-visible, .wallet:focus-visible, .tab:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.link { background: none; border: 0; padding: 0; color: var(--accent); cursor: pointer; font: var(--mono); text-align: left; }
input, select { background: var(--panel-2); color: var(--text); border: 1px solid var(--line); border-radius: 8px; padding: 8px 10px; font: inherit; width: 100%; }
.create input { width: 72px; }
label { display: flex; flex-direction: column; gap: 6px; font-size: 13px; color: var(--muted); }
.wallets { list-style: none; margin: 0; padding: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; min-height: 0; }
.wallet { width: 100%; text-align: left; background: var(--panel-2); border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; color: inherit; font: inherit; cursor: pointer; display: flex; flex-direction: column; gap: 4px; }
.wallet:hover { border-color: var(--muted); } .wallet.selected { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
.wallet .row.small { gap: 12px; color: var(--muted); }
.empty { padding: 12px 0; }
.badge { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; padding: 2px 10px; border-radius: 999px; border: 1px solid currentColor; white-space: nowrap; }
.badge.ok { color: var(--ok); } .badge.bad { color: var(--bad); } .badge.busy { color: var(--busy); }
.spin { width: 10px; height: 10px; border-radius: 50%; border: 2px solid currentColor; border-top-color: transparent; animation: spin .8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .spin { animation: none; } }
.kv { display: grid; grid-template-columns: auto 1fr; gap: 4px 16px; margin: 0; }
.kv dt { color: var(--muted); } .kv dd { margin: 0; min-width: 0; }
.kv.wide { grid-template-columns: 130px 1fr; }
.missing { color: var(--bad); font-weight: 600; }
.hint { background: var(--panel-2); border-radius: 8px; padding: 10px 12px; border-left: 3px solid var(--busy); }
.hint.bad { border-left-color: var(--bad); } .hint p { margin: 0 0 8px; } .hint p:last-child { margin: 0; }
.banner { padding: 10px 14px; border-radius: 8px; cursor: pointer; margin: 8px 16px 0; }
.banner.bad { background: color-mix(in srgb, var(--bad) 18%, var(--panel)); border: 1px solid var(--bad); }
.unlock { width: min(420px, 100%); } .unlock h1 { font-size: 22px; }
.copyable { user-select: all; }
.seed ol { columns: 3; padding-left: 24px; margin: 8px 0 0; font-family: var(--mono); }
.token { flex-direction: row; gap: 16px; align-items: flex-start; }
.token-img { width: 120px; height: 120px; object-fit: cover; border-radius: 10px; background: var(--panel-2); flex: none; }
.token-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 10px; }
@media (max-width: 900px) {
  .body { grid-template-columns: 1fr; } .token { flex-direction: column; } .topbar { flex-wrap: wrap; gap: 12px; }
}
```

- [ ] **Step 9: Typecheck, build và chạy thử**

Run: `npx tsc --noEmit && npm run build:web`
Expected: không lỗi; `web/dist/index.html` được tạo.

Run: `npm start` rồi mở `http://127.0.0.1:8787`.
Expected (kiểm tra bằng mắt): thấy màn hình đặt mật khẩu chủ; sau khi đặt, thấy khung hai cột với "Ví tổng" và "Ví con". Bấm "Tạo ví tổng" hiện một ví tổng ở trạng thái "Đang cấp tNIGHT" kèm hướng dẫn faucet. Dừng server.

- [ ] **Step 10: Commit**

```bash
git add web
git commit -m "feat: giao diện khung, mở khóa, danh sách ví và chi tiết ví"
```

---

### Task 13: Giao diện — tab Mint token

**Files:**
- Modify: `web/src/components/MintPanel.tsx` (thay bản tạm của Task 12)
- Create: `web/src/lib/mint-plan.ts`
- Test: `web/src/lib/mint-plan.test.ts`

**Interfaces:**
- Consumes: `api.mint`, `applyTemplate`-tương đương phía giao diện (`planNames`), `PublicWallet`.
- Produces: `planNames(template, walletIds): Array<{ walletId: string; name: string; symbol: string }>`, `validateTemplate(t): Record<string, string>` (kiểm tra nhanh phía giao diện cho phản hồi tức thì; backend vẫn là nơi kiểm tra chính thức).

- [ ] **Step 1: Viết test thất bại**

`web/src/lib/mint-plan.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { planNames, validateTemplate } from './mint-plan';

const tpl = { name: 'Papa Coin #{n}', symbol: 'PAPA{n}', decimals: 6, amount: '1000' };

describe('planNames', () => {
  it('sinh name/symbol theo thứ tự ví', () => {
    expect(planNames(tpl, ['a', 'b', 'c'])).toEqual([
      { walletId: 'a', name: 'Papa Coin #1', symbol: 'PAPA1' },
      { walletId: 'b', name: 'Papa Coin #2', symbol: 'PAPA2' },
      { walletId: 'c', name: 'Papa Coin #3', symbol: 'PAPA3' },
    ]);
  });
  it('viết hoa symbol', () => {
    expect(planNames({ ...tpl, symbol: 'papa{n}' }, ['a'])[0].symbol).toBe('PAPA1');
  });
});

describe('validateTemplate', () => {
  it('mẫu hợp lệ không có lỗi', () => {
    expect(validateTemplate(tpl, 3, true)).toEqual({});
  });
  it('báo lỗi từng field', () => {
    const e = validateTemplate({ name: '', symbol: 'a b', decimals: 19, amount: '0' }, 1, false);
    expect(Object.keys(e).sort()).toEqual(['amount', 'decimals', 'image', 'name', 'symbol']);
  });
  it('nhiều ví mà symbol không có {n}', () => {
    const e = validateTemplate({ ...tpl, symbol: 'PAPA' }, 2, true);
    expect(e.symbol).toMatch(/\{n\}/);
  });
  it('số lượng nhân decimals vượt Uint64', () => {
    const e = validateTemplate({ ...tpl, decimals: 18, amount: '19' }, 1, true);
    expect(e.amount).toMatch(/Uint64/);
  });
  it('chưa chọn ví', () => {
    expect(validateTemplate(tpl, 0, true).wallets).toMatch(/ví/);
  });
  it('symbol sinh ra vượt 12 ký tự', () => {
    const e = validateTemplate({ ...tpl, symbol: 'ABCDEFGHIJKL{n}' }, 1, true);
    expect(e.symbol).toMatch(/12/);
  });
});
```

Run: `npx vitest run web/src/lib/mint-plan.test.ts`
Expected: FAIL (không tìm thấy module).

- [ ] **Step 2: Viết `mint-plan.ts`**

```ts
const MAX_U64 = 18446744073709551615n;

export interface Template {
  name: string;
  symbol: string;
  decimals: number;
  amount: string;
}

const fill = (s: string, n: number) => s.replaceAll('{n}', String(n));

export function planNames(t: Template, walletIds: string[]) {
  return walletIds.map((walletId, i) => ({
    walletId,
    name: fill(t.name, i + 1).trim(),
    symbol: fill(t.symbol, i + 1).trim().toUpperCase(),
  }));
}

export function validateTemplate(t: Template, walletCount: number, hasImage: boolean): Record<string, string> {
  const e: Record<string, string> = {};
  if (walletCount < 1) e.wallets = 'Chọn ít nhất một ví';
  const names = planNames(t, Array.from({ length: Math.max(walletCount, 1) }, (_, i) => String(i)));
  const lastName = names[names.length - 1].name;
  if (!t.name.trim()) e.name = 'Nhập tên token';
  else if (lastName.length > 64) e.name = 'Tên token tối đa 64 ký tự';
  const sym = names[names.length - 1].symbol;
  if (!t.symbol.trim()) e.symbol = 'Nhập symbol';
  else if (sym.length > 12) e.symbol = 'Symbol tối đa 12 ký tự (kể cả số thứ tự)';
  else if (!/^[A-Z0-9]+$/.test(sym)) e.symbol = 'Symbol chỉ gồm chữ cái và số, không dấu, không khoảng trắng';
  else if (walletCount > 1 && !t.symbol.includes('{n}')) e.symbol = 'Nhiều ví: symbol phải chứa {n} để mỗi ví một symbol riêng';
  if (!Number.isInteger(t.decimals) || t.decimals < 0 || t.decimals > 18) e.decimals = 'Decimals từ 0 đến 18';
  if (!/^[1-9][0-9]*$/.test(t.amount)) e.amount = 'Số lượng là số nguyên dương';
  else if (!e.decimals && BigInt(t.amount) * 10n ** BigInt(t.decimals) > MAX_U64) e.amount = 'Số lượng vượt giới hạn Uint64 sau khi nhân decimals';
  if (!hasImage) e.image = 'Chọn ảnh cho token';
  return e;
}
```

Run: `npx vitest run web/src/lib/mint-plan.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 3: Viết `MintPanel.tsx` đầy đủ**

```tsx
import { useMemo, useState, type FormEvent } from 'react';
import type { PublicWallet } from '../../../server/src/types';
import { api } from '../api';
import { planNames, validateTemplate } from '../lib/mint-plan';
import { StatusBadge } from './StatusBadge';

interface Props {
  wallets: PublicWallet[];
  onMinted: () => void;
  onError: (m: string) => void;
}

export function MintPanel({ wallets, onMinted, onError }: Props) {
  const ready = wallets.filter((w) => w.status === 'ready');
  const [selected, setSelected] = useState<string[]>([]);
  const [name, setName] = useState('Papa Coin #{n}');
  const [symbol, setSymbol] = useState('PAPA{n}');
  const [decimals, setDecimals] = useState(6);
  const [amount, setAmount] = useState('1000000');
  const [image, setImage] = useState<File | null>(null);
  const [overrides, setOverrides] = useState<Record<string, { name?: string; symbol?: string }>>({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<number | null>(null);

  const preview = useMemo(() => URL.createObjectURL(image ?? new Blob()), [image]);
  const template = { name, symbol, decimals, amount };
  const errors = validateTemplate(template, selected.length, image !== null);
  const plan = planNames(template, selected);
  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (Object.keys(errors).length > 0 || !image) return;
    setBusy(true);
    setDone(null);
    try {
      const tokens = await api.mint({ walletIds: selected, template, overrides }, image);
      setDone(tokens.length);
      onMinted();
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack" onSubmit={submit} noValidate>
      <section className="card">
        <h2>1. Chọn ví</h2>
        {ready.length === 0 && <p className="muted">Chưa có ví nào ở trạng thái Sẵn sàng (cần có DUST). Tạo ví ở bên trái và đợi tới khi Sẵn sàng.</p>}
        <div className="row">
          {ready.length > 0 && (
            <button type="button" className="btn" onClick={() => setSelected(selected.length === ready.length ? [] : ready.map((w) => w.id))}>
              {selected.length === ready.length ? 'Bỏ chọn tất cả' : 'Chọn tất cả ví sẵn sàng'}
            </button>
          )}
          <span className="muted small">{selected.length} ví được chọn</span>
        </div>
        <ul className="wallets">
          {ready.map((w) => (
            <li key={w.id}>
              <label className="check">
                <input type="checkbox" checked={selected.includes(w.id)} onChange={() => toggle(w.id)} />
                <span>{w.label}</span>
                <StatusBadge status={w.status} />
              </label>
            </li>
          ))}
        </ul>
        {errors.wallets && <p className="field-error">{errors.wallets}</p>}
      </section>

      <section className="card">
        <h2>2. Thông tin token</h2>
        <p className="muted small">Mỗi ví tạo một token riêng. Dùng <code>{'{n}'}</code> trong tên/symbol để đánh số theo thứ tự ví (1, 2, 3…).</p>
        <div className="grid2">
          <label>Name<input value={name} onChange={(e) => setName(e.target.value)} />{errors.name && <span className="field-error">{errors.name}</span>}</label>
          <label>Symbol<input value={symbol} onChange={(e) => setSymbol(e.target.value)} />{errors.symbol && <span className="field-error">{errors.symbol}</span>}</label>
          <label>Decimals<input type="number" min={0} max={18} value={decimals} onChange={(e) => setDecimals(Number(e.target.value))} />{errors.decimals && <span className="field-error">{errors.decimals}</span>}</label>
          <label>Số lượng mỗi ví (đơn vị token)<input inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.trim())} />{errors.amount && <span className="field-error">{errors.amount}</span>}</label>
        </div>
        <label>Ảnh token (PNG, JPEG hoặc WEBP, tối đa 5 MB)
          <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => setImage(e.target.files?.[0] ?? null)} />
          {errors.image && <span className="field-error">{errors.image}</span>}
        </label>
        {image && <img className="token-img" src={preview} alt="Xem trước ảnh token" />}
      </section>

      <section className="card">
        <h2>3. Xem lại trước khi mint</h2>
        {selected.length === 0 ? <p className="muted">Chọn ví để xem trước.</p> : (
          <table className="plan">
            <thead><tr><th>Ví</th><th>Name</th><th>Symbol</th></tr></thead>
            <tbody>
              {plan.map((p) => {
                const w = wallets.find((x) => x.id === p.walletId);
                return (
                  <tr key={p.walletId}>
                    <td>{w?.label}</td>
                    <td><input value={overrides[p.walletId]?.name ?? p.name} onChange={(e) => setOverrides((o) => ({ ...o, [p.walletId]: { ...o[p.walletId], name: e.target.value } }))} /></td>
                    <td><input value={overrides[p.walletId]?.symbol ?? p.symbol} onChange={(e) => setOverrides((o) => ({ ...o, [p.walletId]: { ...o[p.walletId], symbol: e.target.value.toUpperCase() } }))} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <div className="row">
          <button className="btn primary" disabled={busy || Object.keys(errors).length > 0}>
            {busy ? 'Đang gửi…' : `Mint cho ${selected.length} ví`}
          </button>
          {done !== null && <span className="ok-text">Đã đưa {done} token vào hàng đợi. Theo dõi ở tab Ví.</span>}
        </div>
      </section>
    </form>
  );
}
```

Thêm vào cuối `web/src/styles.css`:

```css
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
@media (max-width: 700px) { .grid2 { grid-template-columns: 1fr; } }
.check { flex-direction: row; align-items: center; gap: 10px; color: var(--text); padding: 6px 0; }
.check input { width: auto; }
.field-error { color: var(--bad); font-size: 12px; margin: 0; }
.ok-text { color: var(--ok); }
.plan { width: 100%; border-collapse: collapse; }
.plan th { text-align: left; color: var(--muted); font-weight: 500; padding: 6px 8px 6px 0; }
.plan td { padding: 4px 8px 4px 0; }
code { font-family: var(--mono); background: var(--panel-2); padding: 1px 5px; border-radius: 4px; }
```

- [ ] **Step 4: Typecheck, test, build**

Run: `npx tsc --noEmit && npx vitest run && npm run build:web`
Expected: tất cả đạt.

- [ ] **Step 5: Kiểm tra bằng mắt**

Run: `npm start`, mở `http://127.0.0.1:8787`, vào tab "Mint token".
Expected: thấy 3 khối; để trống ảnh thì nút Mint bị khóa và có chữ "Chọn ảnh cho token"; nhập symbol `a b` thì báo lỗi; nhập decimals 18 và số lượng 19 thì báo vượt Uint64.

- [ ] **Step 6: Commit**

```bash
git add web/src
git commit -m "feat: giao diện tab Mint token với kiểm tra tức thì và xem trước"
```

---

### Task 14: Nghiệm thu từ đầu đến cuối trên mạng thật và tài liệu

**Files:**
- Create: `README.md`
- Create: `server/test/live/e2e.live.test.ts`

**Interfaces:**
- Consumes: toàn bộ các task trước.

- [ ] **Step 1: Viết test e2e live (Engine thật + chuỗi thật, không qua HTTP)**

`server/test/live/e2e.live.test.ts`:

```ts
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
```

- [ ] **Step 2: Chạy test e2e**

Run (PowerShell): `$env:SPIKE_MNEMONIC="<24 từ ví tổng đã có tNIGHT + DUST>"; npm run test:live -- e2e`
Expected: PASS. Mất tới vài chục phút trên preprod (đồng bộ nhiều ví). Ghi lại tổng thời gian; nếu preprod lỗi nhiều hoặc kẹt sync, đổi `NETWORK=preview`, xin tNIGHT từ faucet preview cho một ví mới, và chạy lại.

- [ ] **Step 3: Nghiệm thu bằng giao diện (kịch bản người dùng thật)**

Chạy `npm run proof:up` và `npm start`, mở `http://127.0.0.1:8787` rồi thực hiện:
1. Đặt mật khẩu chủ. Bấm "Tạo ví tổng". Chép địa chỉ, mở faucet, giải captcha, xin tNIGHT. Chờ ví tổng chuyển sang "Sẵn sàng" (tự phát hiện, có thể mất vài phút).
2. Bấm "Tạo 3 ví". Thấy từng ví đi qua: Đang cấp tNIGHT → Đang đồng bộ → Đang sinh DUST → Sẵn sàng.
3. Tab "Mint token": chọn cả 3 ví, nhập `Papa Coin #{n}` / `PAPA{n}` / decimals 6 / số lượng 1000, chọn ảnh PNG, bấm Mint. Thấy bảng tiến trình token đi qua deploy → mint → Hoàn tất.
4. Quay lại tab "Ví", bấm lần lượt từng ví: mỗi ví chỉ hiển thị token của chính nó, đủ Name, Symbol, Decimals, Số lượng, Ảnh (hiển thị ảnh thật từ IPFS), SHA-256, Contract, Màu token, Tx deploy, Tx mint; không có ô nào ghi "Thiếu".
5. Bấm "Xem seedphrase" của một ví, nhập mật khẩu chủ, thấy 24 từ. Nhập thử seedphrase đó vào Lace (mạng Preprod): địa chỉ unshielded khớp với địa chỉ trong app và thấy token.
6. Tắt app (Ctrl+C) khi một token đang ở bước "Đang mint", mở lại bằng `npm start` và mở khóa: token tự chạy tiếp, không deploy lại (địa chỉ contract không đổi).

Expected: cả 6 mục đạt. Ghi lại mục nào không đạt cùng thông báo lỗi.

- [ ] **Step 4: Viết `README.md`**

````markdown
# Midnight Minter

App chạy local để tạo nhiều ví Midnight, cấp tNIGHT và DUST, rồi mint token riêng cho từng ví (mỗi ví một contract, một loại token), có đủ name, symbol, decimals, số lượng và ảnh IPFS.

## Yêu cầu

- Node 22+, Docker Desktop, WSL 2 (Ubuntu) có Compact compiler 0.31.1.
- Token Blockfrost cho Midnight Preprod (hoặc dùng `NETWORK=preview`, không cần token).
- JWT của Pinata để upload ảnh lên IPFS.

## Cài đặt

```bash
npm install
cp .env.example .env     # điền BLOCKFROST_PROJECT_ID và PINATA_JWT
npm run contract:build   # biên dịch contract qua WSL
npm run proof:up         # chạy proof server (Docker, cổng 6300)
npm start                # build giao diện và chạy tại http://127.0.0.1:8787
```

Phát triển: `npm run dev:server` và `npm run dev:web` (giao diện ở cổng 5173).

## Cách dùng

1. Đặt mật khẩu chủ (mã hóa seedphrase của mọi ví; không khôi phục được nếu quên).
2. Tạo **ví tổng**, xin tNIGHT cho nó bằng tay ở trang faucet (có captcha nên không tự động hóa được). App tự phát hiện tiền về.
3. Tạo ví con bằng một nút: app tự cấp tNIGHT từ ví tổng, đồng bộ và đăng ký DUST.
4. Tab **Mint token**: chọn ví, nhập thông tin, chọn ảnh, bấm Mint.
5. Tab **Ví**: bấm vào ví nào thì hiện token của ví đó.

## Lưu ý

- Token trên preprod/preview là token thử nghiệm, chưa có giá trị thật.
- Giao thức Midnight chưa có chuẩn hiển thị metadata thống nhất: Lace và sàn có thể chưa hiện tên/ảnh dù metadata đã nằm đầy đủ trong ledger của contract. Giao diện của app đọc từ chính dữ liệu đó.
- Lệnh `compact` trên Windows là công cụ nén NTFS; compiler Compact thật chỉ chạy trong WSL (script `contract:build` đã xử lý).
- Đồng bộ ví lần đầu trên preprod có thể rất chậm. Nếu lỗi nhiều, đặt `NETWORK=preview` trong `.env`.
- `.env` và thư mục `data/` chứa bí mật; không commit, không chia sẻ.
````

- [ ] **Step 5: Chạy toàn bộ kiểm tra cuối**

Run: `npx vitest run && npx tsc --noEmit && git status --short`
Expected: toàn bộ test đạt, typecheck sạch, `git status` không liệt kê `.env`, `data/`, `managed/`.

- [ ] **Step 6: Commit**

```bash
git add README.md server/test/live/e2e.live.test.ts
git commit -m "docs: README và test nghiệm thu e2e trên mạng thật"
```
