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
