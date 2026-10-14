import { getNetworkConfig } from '../../server/src/config/networks';
import { loadEnv } from '../../server/src/config/env';
import { deriveKeys } from '../../server/src/chain/keys';
import { openWallet } from '../../server/src/chain/wallet-runtime';

const env = loadEnv();
const network = getNetworkConfig(env.network, { blockfrostProjectId: env.blockfrostProjectId, proofServerUrl: env.proofServerUrl });
const keys = await deriveKeys(process.env.SPIKE_MNEMONIC!, network.networkId);
const t0 = Date.now();
const w = await openWallet(network, keys);
const j = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x));
const sub = w.facade.state().subscribe((s) => {
  const pick = (o: any) => (o && typeof o === 'object' ? j(o.progress ?? o.syncProgress ?? Object.keys(o)) : String(o));
  console.log(`[${Math.round((Date.now() - t0) / 1000)}s] synced=${s.isSynced} shielded=${pick(s.shielded)} unshielded=${pick(s.unshielded)} dust=${pick(s.dust)}`);
});
await new Promise((r) => setTimeout(r, Number(process.env.PROBE_SECONDS ?? 300) * 1000));
sub.unsubscribe();
await w.close();
process.exit(0);
