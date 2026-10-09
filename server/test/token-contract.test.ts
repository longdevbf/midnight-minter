import { createHmac, randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// validatePassword thật, nhưng có thể ép lỗi cho các test đường thử lại.
const forced = vi.hoisted(() => ({ failNext: 0, failAlways: false }));
vi.mock('@midnight-ntwrk/midnight-js-utils', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@midnight-ntwrk/midnight-js-utils')>();
  return {
    ...orig,
    validatePassword: (p: string) => {
      if (forced.failAlways) throw new Error('forced');
      if (forced.failNext > 0) {
        forced.failNext -= 1;
        throw new Error('forced');
      }
      return orig.validatePassword(p);
    },
  };
});

import { validatePassword } from '@midnight-ntwrk/midnight-js-utils';
import { derivePrivateStatePassword } from '../src/chain/token-contract';

const candidate = (secret: string, n: number) =>
  'Pk-' + createHmac('sha256', secret).update(`minter:private-state:v1:${n}`).digest('hex').slice(0, 24);

const fakeSecret = () => Array.from({ length: 24 }, () => randomUUID().slice(0, 8)).join(' ');

describe('derivePrivateStatePassword', () => {
  beforeEach(() => {
    forced.failNext = 0;
    forced.failAlways = false;
  });

  it('500 secret ngẫu nhiên đều cho mật khẩu mà validatePassword thật chấp nhận', () => {
    // Dùng validatePassword thật (bản mock ủy quyền cho bản gốc khi không ép lỗi).
    for (let i = 0; i < 500; i++) {
      const p = derivePrivateStatePassword(fakeSecret());
      expect(typeof p).toBe('string');
      expect(() => validatePassword(p)).not.toThrow();
    }
  });

  it('xác định với cùng secret, khác nhau với secret khác', () => {
    const s = fakeSecret();
    expect(derivePrivateStatePassword(s)).toBe(derivePrivateStatePassword(s));
    expect(derivePrivateStatePassword(s)).not.toBe(derivePrivateStatePassword(fakeSecret()));
  });

  it('không chứa secret', () => {
    const s = fakeSecret();
    expect(derivePrivateStatePassword(s)).not.toContain(s.slice(0, 8));
  });

  it('dùng ứng viên bộ đếm 0 khi hợp lệ', () => {
    const s = fakeSecret();
    expect(derivePrivateStatePassword(s)).toBe(candidate(s, 0));
  });

  it('ép validatePassword lỗi: thử lại với bộ đếm kế tiếp', () => {
    const s = fakeSecret();
    forced.failNext = 2;
    const p = derivePrivateStatePassword(s);
    expect(p).not.toBe(candidate(s, 0));
    expect(p).not.toBe(candidate(s, 1));
    expect(p).toBe(candidate(s, 2));
  });

  it('bỏ cuộc sau 1000 lần thử', () => {
    forced.failAlways = true;
    expect(() => derivePrivateStatePassword(fakeSecret())).toThrow(/Không tạo được mật khẩu/);
  });

  it('bỏ cuộc đúng sau 1000 lần gọi validatePassword', () => {
    forced.failNext = 999;
    // lần thứ 1000 (n = 999) hợp lệ thì vẫn thành công
    expect(() => derivePrivateStatePassword(fakeSecret())).not.toThrow();
    forced.failNext = 1000;
    expect(() => derivePrivateStatePassword(fakeSecret())).toThrow(/Không tạo được mật khẩu/);
  });
});
