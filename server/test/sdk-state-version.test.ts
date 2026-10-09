import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SDK_STATE_VERSION } from '../src/engine/engine';

const installed = (pkg: string) =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`../../node_modules/${pkg}/package.json`, import.meta.url)), 'utf8')) as {
    name: string;
    version: string;
  };

describe('SDK_STATE_VERSION khớp SDK ví đã cài (R1)', () => {
  it('đổi phiên bản @midnightntwrk/wallet-sdk thì phải cập nhật hằng số (snapshot cũ sẽ bị bỏ qua)', () => {
    const p = installed('@midnightntwrk/wallet-sdk');
    expect(SDK_STATE_VERSION).toBe(`${p.name}@${p.version}`);
  });
});
