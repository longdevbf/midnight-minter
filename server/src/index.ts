import { resolve } from 'node:path';
import { realChain } from './chain/chain';
import { loadEnv } from './config/env';
import { getNetworkConfig } from './config/networks';
import { openStore } from './db/store';
import { Engine } from './engine/engine';
import { createIpfs } from './ipfs/pinata';
import { installConsoleRedaction, makeRedactor } from './lib/redact';
import { buildApp } from './app';
import { createSession } from './session';

const env = loadEnv();
// Che khóa Blockfrost/Pinata trong mọi dòng log (SDK in nguyên URL RPC kèm ?project_id=<khóa>).
const redact = makeRedactor([env.blockfrostProjectId, env.pinataJwt]);
installConsoleRedaction(redact);
const network = getNetworkConfig(env.network, {
  blockfrostProjectId: env.blockfrostProjectId,
  proofServerUrl: env.proofServerUrl,
});
const store = openStore(resolve(env.dataDir, 'minter.db'));
const session = createSession(
  store,
  (vault, bus) => new Engine({
      store,
      vault,
      chain: realChain,
      network,
      bus,
      fundAmount: env.fundAmount,
      maxOpenWallets: env.maxOpenWallets,
      redact,
    }),
);
const app = await buildApp({
  store,
  session,
  ipfs: createIpfs({ jwt: env.pinataJwt, gateway: env.ipfsGateway }),
  network,
  fundAmount: env.fundAmount,
  webDir: resolve(import.meta.dirname, '../../web/dist'),
});

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return; // bỏ qua tín hiệu lặp lại
  shuttingDown = true;
  console.log(`Nhận ${signal}, đang tắt...`);
  let code = 0;
  try {
    await session.close();
    await app.close();
    store.close();
  } catch (e) {
    code = 1;
    console.error('Lỗi khi tắt máy chủ:', e instanceof Error ? e.message : String(e));
  }
  process.exit(code);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

await app.listen({ host: '127.0.0.1', port: env.port });
console.log(`Midnight Minter chạy tại http://127.0.0.1:${env.port} (mạng ${network.name})`);
