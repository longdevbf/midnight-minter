import { z } from 'zod';
import { NIGHT_DECIMALS } from '../../../shared/units';
import type { NetworkName } from './networks';

const EnvSchema = z.object({
  NETWORK: z.enum(['preprod', 'preview']).default('preprod'),
  BLOCKFROST_PROJECT_ID: z.string().trim().min(1).optional(),
  PINATA_JWT: z.string({ error: 'Thiếu PINATA_JWT trong .env' }).trim().min(20, 'PINATA_JWT không hợp lệ'),
  PROOF_SERVER_URL: z.string().url().optional(),
  PORT: z.coerce.number().int().min(1024).max(65535).default(8787),
  DATA_DIR: z.string().min(1).default('data'),
  IPFS_GATEWAY: z.string().url().default('https://gateway.pinata.cloud/ipfs/'),
  FUND_AMOUNT: z.coerce.number().int().positive().default(100),
});

export interface AppEnv {
  network: NetworkName;
  blockfrostProjectId?: string;
  pinataJwt: string;
  proofServerUrl?: string;
  port: number;
  dataDir: string;
  ipfsGateway: string;
  /** đơn vị nhỏ nhất của tNIGHT cấp cho mỗi ví con */
  fundAmount: bigint;
}

export function loadEnv(src: Record<string, string | undefined> = process.env): AppEnv {
  const parsed = EnvSchema.safeParse(src);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.') || 'env'}: ${i.message}`).join('; ');
    throw new Error(`Cấu hình .env không hợp lệ: ${msg}`);
  }
  const e = parsed.data;
  return {
    network: e.NETWORK,
    blockfrostProjectId: e.BLOCKFROST_PROJECT_ID,
    pinataJwt: e.PINATA_JWT,
    proofServerUrl: e.PROOF_SERVER_URL,
    port: e.PORT,
    dataDir: e.DATA_DIR,
    ipfsGateway: e.IPFS_GATEWAY.endsWith('/') ? e.IPFS_GATEWAY : `${e.IPFS_GATEWAY}/`,
    fundAmount: BigInt(e.FUND_AMOUNT) * 10n ** BigInt(NIGHT_DECIMALS),
  };
}
