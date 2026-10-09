import { describe, expect, it } from 'vitest';
import { JobQueue } from '../src/engine/job-queue';

describe('JobQueue', () => {
  it('chạy tuần tự theo thứ tự thêm vào', async () => {
    const log: string[] = [];
    const q = new JobQueue(async (j) => {
      log.push(`start ${j.id}`);
      await new Promise((r) => setTimeout(r, 10));
      log.push(`end ${j.id}`);
    });
    q.enqueue({ type: 'wallet', id: 'a' });
    q.enqueue({ type: 'wallet', id: 'b' });
    await q.idle();
    expect(log).toEqual(['start a', 'end a', 'start b', 'end b']);
  });

  it('bỏ qua job trùng khóa khi đang chờ hoặc đang chạy', async () => {
    let runs = 0;
    const q = new JobQueue(async () => { runs++; await new Promise((r) => setTimeout(r, 20)); });
    expect(q.enqueue({ type: 'wallet', id: 'a' })).toBe(true);
    expect(q.enqueue({ type: 'wallet', id: 'a' })).toBe(false);
    await q.idle();
    expect(runs).toBe(1);
    expect(q.enqueue({ type: 'wallet', id: 'a' })).toBe(true);
    await q.idle();
    expect(runs).toBe(2);
  });

  it('job khác loại cùng id không bị coi là trùng', async () => {
    let runs = 0;
    const q = new JobQueue(async () => { runs++; });
    q.enqueue({ type: 'wallet', id: 'a' });
    q.enqueue({ type: 'refresh', id: 'a' });
    await q.idle();
    expect(runs).toBe(2);
  });

  it('một job lỗi không làm dừng hàng đợi', async () => {
    const done: string[] = [];
    const q = new JobQueue(async (j) => {
      if (j.id === 'bad') throw new Error('boom');
      done.push(j.id);
    });
    q.enqueue({ type: 'token', id: 'bad' });
    q.enqueue({ type: 'token', id: 'good' });
    await q.idle();
    expect(done).toEqual(['good']);
  });
});
