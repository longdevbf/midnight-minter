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

  const isTimeoutError = (err: unknown): err is Error & { name: string } => {
    return err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
  };

  const maskSecrets = (text: string): string => {
    if (!opts.jwt) return text;
    return text.split(opts.jwt).join('***');
  };

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
      } catch (err) {
        if (isTimeoutError(err)) {
          throw new Error('Pinata không phản hồi sau 60 giây, hãy thử lại');
        }
        throw new Error('Không kết nối được Pinata (kiểm tra mạng hoặc thử lại)');
      }
      if (!res.ok) {
        let body = '';
        try {
          body = await res.text();
        } catch {
          // If reading body fails, just use empty body but still throw
        }
        const maskedBody = maskSecrets(body).slice(0, 200);
        throw new Error(`Pinata từ chối upload ảnh (HTTP ${res.status}): ${maskedBody}`);
      }
      let json: unknown;
      try {
        json = await res.json();
      } catch (err) {
        if (isTimeoutError(err)) {
          throw new Error('Pinata không phản hồi sau 60 giây, hãy thử lại');
        }
        throw new Error('Phản hồi Pinata không hợp lệ (không phải JSON)');
      }
      // Validate response is a non-null, non-array object
      if (json === null || Array.isArray(json) || typeof json !== 'object') {
        throw new Error('Phản hồi Pinata không hợp lệ (không phải JSON)');
      }
      const parsed = json as { IpfsHash?: unknown };
      if (typeof parsed.IpfsHash !== 'string') {
        throw new Error('Phản hồi Pinata không có IpfsHash (hoặc không phải string)');
      }
      return { cid: parsed.IpfsHash, uri: `ipfs://${parsed.IpfsHash}`, gatewayUrl: `${gateway}${parsed.IpfsHash}` };
    },
  };
}
