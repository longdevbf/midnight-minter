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
