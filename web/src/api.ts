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
