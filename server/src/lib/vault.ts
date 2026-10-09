import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 128 * 1024 * 1024 };

export interface Vault {
  encrypt(plain: string): string;
  decrypt(blob: string): string;
}

export function makeSalt(): Buffer {
  return randomBytes(16);
}

export function createVault(password: string, salt: Buffer): Vault {
  if (password.length < 8) throw new Error('Mật khẩu chủ phải có ít nhất 8 ký tự');
  const key = scryptSync(password, salt, 32, SCRYPT);
  return {
    encrypt(plain) {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
      return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), enc.toString('base64')].join(':');
    },
    decrypt(blob) {
      const [version, iv, tag, enc] = blob.split(':');
      if (version !== 'v1' || !iv || !tag || !enc) throw new Error('Dữ liệu mã hóa không hợp lệ');
      try {
        const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
        decipher.setAuthTag(Buffer.from(tag, 'base64'));
        return Buffer.concat([decipher.update(Buffer.from(enc, 'base64')), decipher.final()]).toString('utf8');
      } catch {
        throw new Error('Sai mật khẩu chủ hoặc dữ liệu bị hỏng');
      }
    },
  };
}
