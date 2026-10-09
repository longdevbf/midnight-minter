import { describe, expect, it, vi } from 'vitest';
import { createIpfs } from '../src/ipfs/pinata';

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

describe('pinata', () => {
  it('gửi multipart với Bearer JWT và trả về cid, uri, gatewayUrl', async () => {
    let capturedInit: RequestInit | undefined;
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      capturedInit = init;
      return new Response(JSON.stringify({ IpfsHash: 'bafyCID', PinSize: 11, Timestamp: 'x' }), { status: 200 });
    });
    const ipfs = createIpfs({ jwt: 'JWT123', gateway: 'https://gw.example/ipfs/', fetchImpl: fetchImpl as never });
    const r = await ipfs.pinImage(png, 'logo.png', 'image/png');
    expect(r).toEqual({ cid: 'bafyCID', uri: 'ipfs://bafyCID', gatewayUrl: 'https://gw.example/ipfs/bafyCID' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    // Assertions after call to avoid error swallowing
    expect(capturedInit?.method).toBe('POST');
    expect((capturedInit?.headers as Record<string, string>).Authorization).toBe('Bearer JWT123');
    const form = capturedInit?.body as FormData;
    const file = form?.get('file') as File;
    expect(file.name).toBe('logo.png');
    expect(file.type).toBe('image/png');
    expect(file.size).toBe(png.length);
  });

  it('báo lỗi rõ khi Pinata trả lỗi HTTP (không lộ JWT)', async () => {
    const fetchImpl = vi.fn(async () => new Response('{"error":"bad Bearer SECRETJWT"}', { status: 401 }));
    const ipfs = createIpfs({ jwt: 'SECRETJWT', gateway: 'https://gw/ipfs/', fetchImpl: fetchImpl as never });
    const err = (await ipfs.pinImage(png, 'a.png', 'image/png').catch((e) => e)) as Error;
    expect(err.message).toMatch(/Pinata.*401/);
    expect(err.message).not.toContain('SECRETJWT');
    expect(err.message).toContain('***');
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

  it('báo lỗi khi Pinata trả non-JSON 200 response', async () => {
    const fetchImpl = vi.fn(async () => new Response('<html>Internal Server Error</html>', { status: 200 }));
    const ipfs = createIpfs({ jwt: 'J', gateway: 'https://gw/ipfs/', fetchImpl: fetchImpl as never });
    await expect(ipfs.pinImage(png, 'a.png', 'image/png')).rejects.toThrow(/Phản hồi Pinata không hợp lệ/);
  });

  it('báo lỗi khi fetch timeout', async () => {
    const fetchImpl = vi.fn(async () => {
      throw Object.assign(new Error('timeout'), { name: 'TimeoutError' });
    });
    const ipfs = createIpfs({ jwt: 'J', gateway: 'https://gw/ipfs/', fetchImpl: fetchImpl as never });
    await expect(ipfs.pinImage(png, 'a.png', 'image/png')).rejects.toThrow(/không phản hồi sau 60 giây/);
  });

  it('báo lỗi khi response.json() timeout', async () => {
    const fetchImpl = vi.fn(async () => {
      const resp = new Response('{"IpfsHash":"test"}', { status: 200 });
      const originalJson = resp.json.bind(resp);
      resp.json = async () => {
        throw Object.assign(new Error('timeout'), { name: 'TimeoutError' });
      };
      return resp;
    });
    const ipfs = createIpfs({ jwt: 'J', gateway: 'https://gw/ipfs/', fetchImpl: fetchImpl as never });
    await expect(ipfs.pinImage(png, 'a.png', 'image/png')).rejects.toThrow(/không phản hồi sau 60 giây/);
  });

  it('báo lỗi khi IpfsHash không phải string', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ IpfsHash: 123 }), { status: 200 }));
    const ipfs = createIpfs({ jwt: 'J', gateway: 'https://gw/ipfs/', fetchImpl: fetchImpl as never });
    await expect(ipfs.pinImage(png, 'a.png', 'image/png')).rejects.toThrow(/IpfsHash/);
  });
});
