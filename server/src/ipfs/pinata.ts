export interface PinResult {
  cid: string;
  uri: string;
  gatewayUrl: string;
}

export interface Ipfs {
  pinImage(buf: Buffer, filename: string, mime: string): Promise<PinResult>;
}

export function createIpfs(opts: { jwt: string; gateway: string; fetchImpl?: typeof fetch }): Ipfs {
  const doFetch = opts.fetchImpl ?? fetch;
  const gateway = opts.gateway.endsWith('/') ? opts.gateway : `${opts.gateway}/`;
  return {
    async pinImage(buf, filename, mime) {
      const form = new FormData();
      form.append('file', new Blob([new Uint8Array(buf)], { type: mime }), filename);
      form.append('pinataMetadata', JSON.stringify({ name: filename }));
      let res: Response;
      try {
        res = await doFetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
          method: 'POST',
          headers: { Authorization: `Bearer ${opts.jwt}` },
          body: form,
          signal: AbortSignal.timeout(60_000),
        });
      } catch {
        throw new Error('Không kết nối được Pinata (kiểm tra mạng hoặc thử lại)');
      }
      if (!res.ok) {
        const body = (await res.text()).slice(0, 200);
        throw new Error(`Pinata từ chối upload ảnh (HTTP ${res.status}): ${body}`);
      }
      const json = (await res.json()) as { IpfsHash?: string };
      if (!json.IpfsHash) throw new Error('Phản hồi Pinata không có IpfsHash');
      return { cid: json.IpfsHash, uri: `ipfs://${json.IpfsHash}`, gatewayUrl: `${gateway}${json.IpfsHash}` };
    },
  };
}
