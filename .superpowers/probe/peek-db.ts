import { resolve } from 'node:path';
import Database from 'better-sqlite3';
const db = new Database(resolve('data/minter.db'), { readonly: true });
for (const r of db.prepare("select label,status,failed_step,message,night_balance n,dust_balance d from wallets order by created_at").all() as any[]) console.log(r.label, r.status, r.failed_step ?? '', r.n, r.d, r.message ?? '');
for (const r of db.prepare("select w.label, t.name, t.symbol, t.status, t.failed_step, t.message from tokens t join wallets w on w.id=t.wallet_id").all() as any[]) console.log('TOKEN', r.label, r.name, r.symbol, r.status, r.failed_step ?? '', r.message ?? '');
console.log(db.prepare("select w.label, s.saved_at from wallet_state s join wallets w on w.id=s.wallet_id").all());
