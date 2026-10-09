import { describe, expect, it, vi } from 'vitest';
import { createIpfs } from '../src/ipfs/pinata';

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

describe('pinata', () => {
  it('gửi multipart với Bearer JWT và trả về cid, uri, gatewayUrl', async () => {
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe('https://api.pinata.cloud/pinning/pinFileToIPFS');
      expect((init.headers as Record<string, string>).Authorization).toBe('Bearer JWT123');
      const form = init.body as FormData;
      const file = form.get('file') as File;
      expect(file.name).toBe('logo.png');
      expect(file.type).toBe('image/png');
      expect(file.size).toBe(png.length);
      return new Response(JSON.stringify({ IpfsHash: 'bafyCID', PinSize: 11, Timestamp: 'x' }), { status: 200 });
    });
    const ipfs = createIpfs({ jwt: 'JWT123', gateway: 'https://gw.example/ipfs/', fetchImpl: fetchImpl as never });
    const r = await ipfs.pinImage(png, 'logo.png', 'image/png');
    expect(r).toEqual({ cid: 'bafyCID', uri: 'ipfs://bafyCID', gatewayUrl: 'https://gw.example/ipfs/bafyCID' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('báo lỗi rõ khi Pinata trả lỗi HTTP (không lộ JWT)', async () => {
    const fetchImpl = vi.fn(async () => new Response('{"error":"INVALID_CREDENTIALS"}', { status: 401 }));
    const ipfs = createIpfs({ jwt: 'SECRETJWT', gateway: 'https://gw/ipfs/', fetchImpl: fetchImpl as never });
    const err = (await ipfs.pinImage(png, 'a.png', 'image/png').catch((e) => e)) as Error;
    expect(err.message).toMatch(/Pinata.*401/);
    expect(err.message).not.toContain('SECRETJWT');
  });

  it('báo lỗi khi phản hồi thiếu IpfsHash', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 }));
    const ipfs = createIpfs({ jwt: 'J', gateway: 'https://gw/ipfs/', fetchImpl: fetchImpl as never });
    await expect(ipfs.pinImage(png, 'a.png', 'image/png')).rejects.toThrow(/IpfsHash/);
  });

  it('lỗi mạng được bọc bằng thông báo tiếng Việt', async () => {
    const fetchImpl = vi.fn(async () => { throw new TypeError('fetch failed'); });
    const ipfs = createIpfs({ jwt: 'J', gateway: 'https://gw/ipfs/', fetchImpl: fetchImpl as never });
    await expect(ipfs.pinImage(png, 'a.png', 'image/png')).rejects.toThrow(/Không kết nối được Pinata/);
  });
});
