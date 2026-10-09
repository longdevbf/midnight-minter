import type { NetworkConfig } from '../config/networks';
import { deriveKeys } from './keys';
import { derivePrivateStatePassword, deployToken, mintToken } from './token-contract';
import type { Chain, ChainWallet, WalletSnapshot } from './types';
import { ensureDust, openWallet, readBalances, snapshotWallet, transferNight, waitNight } from './wallet-runtime';

export const realChain: Chain = {
  async open(network: NetworkConfig, mnemonic: string, snapshot?: WalletSnapshot): Promise<ChainWallet> {
    // Chuẩn hóa như deriveKeys: seedphrase dán kèm khoảng trắng/xuống dòng vẫn ra cùng mật khẩu kho trạng thái.
    const normalized = mnemonic.trim().split(/\s+/).join(' ');
    const keys = await deriveKeys(normalized, network.networkId);
    const psPassword = derivePrivateStatePassword(normalized);
    const w = await openWallet(network, keys, snapshot);
    return {
      restored: w.restored,
      snapshot: () => snapshotWallet(w),
      balances: (sync) => readBalances(w, sync),
      waitNight: (min, timeoutMs) => waitNight(w, min, timeoutMs),
      ensureDust: () => ensureDust(w),
      transferNight: (to, amount) => transferNight(w, to, amount),
      deployToken: (a) => deployToken(w, a, psPassword),
      mintToken: (a) => mintToken(w, a, psPassword),
      close: () => w.close(),
    };
  },
};
