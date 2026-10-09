import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 128 * 1024 * 1024 };

// Helper to validate base64 string
function isValidBase64(str: string): boolean {
  try {
    return /^[A-Za-z0-9+/]*={0,2}$/.test(str) && Buffer.from(str, 'base64').toString('base64') === str;
  } catch {
    return false;
  }
}

export interface Vault {
  encrypt(plain: string): string;
  decrypt(blob: string): string;
}

export function makeSalt(): Buffer {
  return randomBytes(16);
}

export function createVault(password: string, salt: Buffer): Vault {
  const normalizedPassword = password.normalize('NFC');
  if (normalizedPassword.length < 8) throw new Error('Mật khẩu chủ phải có ít nhất 8 ký tự');
  const key = scryptSync(normalizedPassword, salt, 32, SCRYPT);
  return {
    encrypt(plain) {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
      const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
      return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), enc.toString('base64')].join(':');
    },
    decrypt(blob) {
      const parts = blob.split(':');
      if (parts.length !== 4) throw new Error('Dữ liệu mã hóa không hợp lệ');
      const [version, ivB64, tagB64, encB64] = parts;
      if (version !== 'v1') throw new Error('Dữ liệu mã hóa không hợp lệ');

      // Validate and decode base64 segments
      if (!isValidBase64(ivB64) || !isValidBase64(tagB64) || !isValidBase64(encB64)) {
        throw new Error('Dữ liệu mã hóa không hợp lệ');
      }

      const iv = Buffer.from(ivB64, 'base64');
      const tag = Buffer.from(tagB64, 'base64');
      const enc = Buffer.from(encB64, 'base64');

      // Validate IV and tag lengths
      if (iv.length !== 12) throw new Error('Dữ liệu mã hóa không hợp lệ');
      if (tag.length !== 16) throw new Error('Dữ liệu mã hóa không hợp lệ');

      try {
        const decipher = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
        decipher.setAuthTag(tag);
        return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
      } catch {
        throw new Error('Sai mật khẩu chủ hoặc dữ liệu bị hỏng');
      }
    },
  };
}
