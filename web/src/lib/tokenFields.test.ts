import { describe, expect, it } from 'vitest';
import type { TokenStatus } from '../../../server/src/types';
import { ALREADY_MINTED, mintTxField, producedField, requiredField } from './tokenFields';

const tok = (status: TokenStatus, failedStep: string | null = null) => ({ status, failedStep });
const HASH = 'a'.repeat(64);

describe('requiredField', () => {
  it('có giá trị thì hiện giá trị', () => {
    expect(requiredField('Foo')).toEqual({ kind: 'value', text: 'Foo' });
  });
  it('null / rỗng luôn là "Thiếu", bất kể trạng thái', () => {
    expect(requiredField(null)).toEqual({ kind: 'missing' });
    expect(requiredField('')).toEqual({ kind: 'missing' });
    expect(requiredField(undefined)).toEqual({ kind: 'missing' });
  });
});

describe('producedField', () => {
  it('có giá trị thì rút gọn và giữ bản đầy đủ để chép', () => {
    const s = producedField(tok('done'), 'deploying', HASH, [14, 10]);
    expect(s).toMatchObject({ kind: 'value', full: HASH });
    expect((s as { text: string }).text).toContain('…');
  });
  it.each(['queued', 'deploying', 'minting'] as const)('null khi %s là "Đang chờ…", không phải "Thiếu"', (st) => {
    expect(producedField(tok(st), 'deploying', null, [14, 10])).toEqual({ kind: 'pending' });
    expect(producedField(tok(st), 'minting', null, [14, 10])).toEqual({ kind: 'pending' });
  });
  it('null khi done là "Thiếu" cho cả hai bước', () => {
    expect(producedField(tok('done'), 'deploying', null, [14, 10])).toEqual({ kind: 'missing' });
    expect(producedField(tok('done'), 'minting', null, [14, 10])).toEqual({ kind: 'missing' });
  });
  it('lỗi ở bước deploy: mọi trường còn trống là "Đang chờ…"', () => {
    expect(producedField(tok('failed', 'deploying'), 'deploying', null, [14, 10])).toEqual({ kind: 'pending' });
    expect(producedField(tok('failed', 'deploying'), 'minting', null, [14, 10])).toEqual({ kind: 'pending' });
  });
  it('lỗi ở bước mint: trường của bước deploy phải có nên null là "Thiếu"; trường của bước mint vẫn chờ', () => {
    expect(producedField(tok('failed', 'minting'), 'deploying', null, [14, 10])).toEqual({ kind: 'missing' });
    expect(producedField(tok('failed', 'minting'), 'minting', null, [14, 10])).toEqual({ kind: 'pending' });
  });
});

describe('mintTxField', () => {
  it('"already-minted" là ghi chú, không bao giờ là mã giao dịch và không có nút chép', () => {
    const s = mintTxField({ ...tok('done'), mintTxId: ALREADY_MINTED });
    expect(s).toEqual({ kind: 'note', text: 'Đã mint trước đó (không có tx mới)' });
    expect(s).not.toHaveProperty('full');
  });
  it('ghi chú hiện cả khi trạng thái chưa done', () => {
    expect(mintTxField({ ...tok('minting'), mintTxId: ALREADY_MINTED }).kind).toBe('note');
  });
  it('hash thật được rút gọn và chép được', () => {
    expect(mintTxField({ ...tok('done'), mintTxId: HASH })).toMatchObject({ kind: 'value', full: HASH });
  });
  it('chưa có tx: theo luật "produced" của bước mint', () => {
    expect(mintTxField({ ...tok('minting'), mintTxId: null })).toEqual({ kind: 'pending' });
    expect(mintTxField({ ...tok('done'), mintTxId: null })).toEqual({ kind: 'missing' });
  });
});
