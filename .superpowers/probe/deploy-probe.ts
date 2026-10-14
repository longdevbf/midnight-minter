import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { openStore } from '../../server/src/db/store';
import { createVault } from '../../server/src/lib/vault';
import { getNetworkConfig } from '../../server/src/config/networks';
import { realChain } from '../../server/src/chain/chain';

const chain = (e: unknown) => { const o: string[] = []; let c: any = e; for (let i = 0; i < 8 && c; i++) { o.push(`${c?.name}: ${c?.message}${c?.code ? ' code=' + c.code : ''}${c?.data ? ' data=' + JSON.stringify(c.data).slice(0, 400) : ''}`); c = c.cause; } return o.join('\n  <- '); };
const store = openStore(resolve('data/minter.db'));
const vault = createVault(process.env.MASTER_PW!, Buffer.from(store.getMeta('vault_salt')!, 'hex'));
const w = store.getWallet(process.env.WALLET_ID!)!;
const row = store.getWalletState(w.id)!;
const snap = JSON.parse(vault.decrypt(row.blob));
const network = getNetworkConfig('preview', { proofServerUrl: 'http://localhost:6301' } as any);
const cw = await realChain.open(network, vault.decrypt(w.encryptedMnemonic), snap);
console.log('restored', cw.restored);
console.log('balances', await cw.balances(true).then((b) => ({ night: String(b.night), dust: String(b.dust), synced: b.synced })));
const t = store.getToken(process.env.TOKEN_ID!)!;
const realSecret = Buffer.from(vault.decrypt(store.getToken(process.env.TOKEN_ID!)!.encryptedOwnerSecret), 'hex');
const base = { name: t.name, symbol: t.symbol, decimals: t.decimals, imageUri: t.imageUri, imageSha256Hex: t.imageSha256 };
import { inspect } from 'node:util';
const tk = store.getToken(process.env.TOKEN_ID!)!;
try {
  const r = await cw.mintToken({ contractAddress: tk.contractAddress!, ownerSecret: realSecret, baseUnits: BigInt(tk.baseUnits) });
  console.log('MINT OK', r.txId, r.tokenColor);
} catch (e: any) {
  let c = e; let k = 0;
  while (c && k++ < 6) { console.log('ERR', c?.name, String(c?.message).slice(0, 200)); console.log(String(c?.stack).split(String.fromCharCode(10)).slice(0, 14).join(String.fromCharCode(10))); c = c.cause; }
}
await cw.close(); store.close(); process.exit(0);
