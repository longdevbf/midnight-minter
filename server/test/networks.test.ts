import { describe, expect, it } from 'vitest';
import { getNetworkConfig } from '../src/config/networks';
import { loadEnv } from '../src/config/env';

describe('getNetworkConfig', () => {
  it('preprod gắn project_id (đã mã hóa URL) vào các URL cần khóa', () => {
    const c = getNetworkConfig('preprod', { blockfrostProjectId: 'abc 123' });
    expect(c.networkId).toBe('preprod');
    expect(c.indexerHttpUrl).toBe('https://midnight-preprod.blockfrost.io/api/v0?project_id=abc%20123');
    expect(c.indexerWsUrl).toBe('wss://midnight-preprod.blockfrost.io/api/v0/ws?project_id=abc%20123');
    expect(c.relayUrl).toBe('wss://rpc.midnight-preprod.blockfrost.io?project_id=abc%20123');
    expect(c.proofServerUrl).toBe('http://localhost:6300');
    expect(c.faucetUrl).toBe('https://midnight-tmnight-preprod.nethermind.dev/');
  });

  it('preprod thiếu project_id thì báo lỗi rõ ràng', () => {
    expect(() => getNetworkConfig('preprod', {})).toThrow(/BLOCKFROST_PROJECT_ID/);
  });

  it('preview không cần khóa', () => {
    const c = getNetworkConfig('preview', {});
    expect(c.networkId).toBe('preview');
    expect(c.indexerHttpUrl).toBe('https://indexer.preview.midnight.network/api/v4/graphql');
    expect(c.indexerWsUrl).toBe('wss://indexer.preview.midnight.network/api/v4/graphql/ws');
    expect(c.relayUrl).toBe('wss://rpc.preview.midnight.network');
  });

  it('cho phép đổi địa chỉ proof server', () => {
    const c = getNetworkConfig('preview', { proofServerUrl: 'http://127.0.0.1:7000' });
    expect(c.proofServerUrl).toBe('http://127.0.0.1:7000');
  });
});

describe('loadEnv', () => {
  const base = { PINATA_JWT: 'x'.repeat(30) };
  it('dùng giá trị mặc định', () => {
    const e = loadEnv(base);
    expect(e.network).toBe('preprod');
    expect(e.port).toBe(8787);
    expect(e.fundAmount).toBe(100_000_000n);
    expect(e.ipfsGateway).toBe('https://gateway.pinata.cloud/ipfs/');
  });
  it('FUND_AMOUNT tính theo tNIGHT và đổi sang đơn vị nhỏ nhất', () => {
    expect(loadEnv({ ...base, FUND_AMOUNT: '50' }).fundAmount).toBe(50_000_000n);
  });
  it('từ chối NETWORK không hợp lệ', () => {
    expect(() => loadEnv({ ...base, NETWORK: 'mainnet' })).toThrow();
  });
  it('thiếu PINATA_JWT thì báo lỗi', () => {
    expect(() => loadEnv({})).toThrow(/PINATA_JWT/);
  });
});
