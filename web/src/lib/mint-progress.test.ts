import { describe, expect, it } from 'vitest';
import type { PublicToken } from '../../../server/src/types';
import { isBatchSettled, mergeBatch, stepStates, summarize, summaryText } from './mint-progress';

const tok = (id: string, status: PublicToken['status'], failedStep: string | null = null): PublicToken =>
  ({ id, status, failedStep, walletId: 'w' + id, name: 'N' + id, symbol: 'S' + id, message: null }) as PublicToken;

const states = (t: Pick<PublicToken, 'status' | 'failedStep'>) => stepStates(t).map((s) => s.state);

describe('stepStates', () => {
  it('có hai bước đúng thứ tự: Deploy contract rồi Mint', () => {
    expect(stepStates({ status: 'queued', failedStep: null }).map((s) => s.label)).toEqual(['Deploy contract', 'Mint']);
  });
  it('queued: cả hai chờ', () => expect(states({ status: 'queued', failedStep: null })).toEqual(['pending', 'pending']));
  it('deploying: deploy đang chạy', () => expect(states({ status: 'deploying', failedStep: null })).toEqual(['active', 'pending']));
  it('minting: deploy xong, mint đang chạy', () => expect(states({ status: 'minting', failedStep: null })).toEqual(['done', 'active']));
  it('done: cả hai xong', () => expect(states({ status: 'done', failedStep: null })).toEqual(['done', 'done']));
  it('failed ở deploying', () => expect(states({ status: 'failed', failedStep: 'deploying' })).toEqual(['failed', 'pending']));
  it('failed ở minting: deploy đã xong', () => expect(states({ status: 'failed', failedStep: 'minting' })).toEqual(['done', 'failed']));
  it('failed không rõ bước: coi như lỗi ở bước đầu', () => {
    expect(states({ status: 'failed', failedStep: null })).toEqual(['failed', 'pending']);
    expect(states({ status: 'failed', failedStep: 'lạ' })).toEqual(['failed', 'pending']);
  });
});

describe('summarize / summaryText', () => {
  const batch = [tok('1', 'done'), tok('2', 'done'), tok('3', 'done'), tok('4', 'failed', 'minting'), tok('5', 'deploying')];
  it('đếm theo trạng thái', () => {
    expect(summarize(batch)).toEqual({ total: 5, done: 3, failed: 1, running: 1 });
  });
  it('câu tóm tắt', () => {
    expect(summaryText(summarize(batch))).toBe('3/5 hoàn tất, 1 lỗi');
  });
  it('không có lỗi thì không nhắc lỗi', () => {
    expect(summaryText(summarize([tok('1', 'done'), tok('2', 'queued')]))).toBe('1/2 hoàn tất');
  });
  it('lô rỗng', () => {
    expect(summaryText(summarize([]))).toBe('0/0 hoàn tất');
  });
});

describe('isBatchSettled', () => {
  it('chỉ true khi mọi dòng done', () => {
    expect(isBatchSettled([tok('1', 'done'), tok('2', 'done')])).toBe(true);
    expect(isBatchSettled([tok('1', 'done'), tok('2', 'failed')])).toBe(false);
    expect(isBatchSettled([tok('1', 'queued')])).toBe(false);
  });
  it('lô rỗng coi như đã xong (không cần tải lại)', () => expect(isBatchSettled([])).toBe(true));
});

describe('mergeBatch', () => {
  it('thay theo id, giữ thứ tự, bỏ qua token lạ', () => {
    const batch = [tok('1', 'queued'), tok('2', 'queued')];
    const fresh = [tok('2', 'done'), tok('9', 'done'), tok('1', 'minting')];
    const merged = mergeBatch(batch, fresh);
    expect(merged.map((t) => [t.id, t.status])).toEqual([['1', 'minting'], ['2', 'done']]);
  });
  it('token không có trong dữ liệu mới thì giữ nguyên', () => {
    const batch = [tok('1', 'queued')];
    expect(mergeBatch(batch, [])).toEqual(batch);
  });
});
