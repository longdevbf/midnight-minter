import type { NetworkConfig } from '../config/networks';
import { deriveKeys } from './keys';
import { derivePrivateStatePassword, deployToken, mintToken } from './token-contract';
import type { Chain, ChainWallet } from './types';
import { ensureDust, openWallet, readBalances, transferNight, waitNight } from './wallet-runtime';

export const realChain: Chain = {
  async open(network: NetworkConfig, mnemonic: string): Promise<ChainWallet> {
    const keys = await deriveKeys(mnemonic, network.networkId);
    const psPassword = derivePrivateStatePassword(mnemonic);
    const w = await openWallet(network, keys);
    return {
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
