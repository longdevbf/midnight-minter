import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { openStore } from '../../server/src/db/store';
import { createVault } from '../../server/src/lib/vault';
import { deriveKeys } from '../../server/src/chain/keys';

const store = openStore(resolve('data/minter.db'));
const salt = store.getMeta('vault_salt');
if (!salt) throw new Error('chưa khởi tạo mật khẩu chủ');
const vault = createVault(process.env.MASTER_PW!, Buffer.from(salt, 'hex'));
if (store.getTreasury()) { console.log('đã có ví tổng, bỏ qua'); process.exit(0); }
const mnemonic = process.env.SPIKE_MNEMONIC!;
const keys = await deriveKeys(mnemonic, 'preview');
const id = randomUUID();
store.insertWallet({
  id, label: 'Ví tổng', kind: 'treasury', network: 'preview',
  unshieldedAddress: keys.unshieldedAddress, encryptedMnemonic: vault.encrypt(mnemonic),
  status: 'created', failedStep: null, message: null, nightBalance: '0', dustBalance: '0', createdAt: Date.now(),
});
console.log('ID=' + id, keys.unshieldedAddress);
store.close();
