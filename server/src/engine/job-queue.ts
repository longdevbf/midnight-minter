export interface Job {
  type: 'wallet' | 'token' | 'refresh';
  id: string;
}

export class JobQueue {
  private pending: Job[] = [];
  private keys = new Set<string>();
  private running = false;
  private waiters: Array<() => void> = [];

  constructor(private readonly worker: (job: Job) => Promise<void>) {}

  enqueue(job: Job): boolean {
    const key = `${job.type}:${job.id}`;
    if (this.keys.has(key)) return false;
    this.keys.add(key);
    // Job mint/token chạy nhanh (ví đã sẵn sàng) nên được chen lên trước các job ví (đồng bộ lạnh ~20 phút mỗi ví).
    if (job.type === 'token') {
      const at = this.pending.findIndex((j) => j.type !== 'token');
      if (at === -1) this.pending.push(job);
      else this.pending.splice(at, 0, job);
    } else {
      this.pending.push(job);
    }
    void this.pump();
    return true;
  }

  idle(): Promise<void> {
    if (!this.running && this.pending.length === 0) return Promise.resolve();
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  private async pump(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (this.pending.length > 0) {
        const job = this.pending.shift() as Job;
        try {
          await this.worker(job);
        } catch (e) {
          console.error('Job lỗi ngoài dự kiến', job, e);
        } finally {
          this.keys.delete(`${job.type}:${job.id}`);
        }
      }
    } finally {
      this.running = false;
      for (const w of this.waiters.splice(0)) w();
    }
  }
}
