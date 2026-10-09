import type { PublicToken } from '../../../server/src/types';

export type StepState = 'pending' | 'active' | 'done' | 'failed';
export interface StepView {
  key: 'deploy' | 'mint';
  label: string;
  state: StepState;
}

type Progress = Pick<PublicToken, 'status' | 'failedStep'>;

/**
 * Hai bước của một token: Deploy contract rồi Mint. Suy ra từ `status`; khi lỗi, `failedStep`
 * cho biết bước nào hỏng ('minting' nghĩa là deploy đã xong). Bước không rõ coi như hỏng ở bước đầu.
 */
export function stepStates(t: Progress): [StepView, StepView] {
  let deploy: StepState;
  let mint: StepState;
  switch (t.status) {
    case 'queued': deploy = 'pending'; mint = 'pending'; break;
    case 'deploying': deploy = 'active'; mint = 'pending'; break;
    case 'minting': deploy = 'done'; mint = 'active'; break;
    case 'done': deploy = 'done'; mint = 'done'; break;
    case 'failed':
      if (t.failedStep === 'minting') { deploy = 'done'; mint = 'failed'; } else { deploy = 'failed'; mint = 'pending'; }
      break;
  }
  return [
    { key: 'deploy', label: 'Deploy contract', state: deploy },
    { key: 'mint', label: 'Mint', state: mint },
  ];
}

export interface Summary {
  total: number;
  done: number;
  failed: number;
  running: number;
}

export function summarize(tokens: Pick<PublicToken, 'status'>[]): Summary {
  const s: Summary = { total: tokens.length, done: 0, failed: 0, running: 0 };
  for (const t of tokens) {
    if (t.status === 'done') s.done++;
    else if (t.status === 'failed') s.failed++;
    else if (t.status === 'deploying' || t.status === 'minting') s.running++;
  }
  return s;
}

export function summaryText(s: Summary): string {
  return `${s.done}/${s.total} hoàn tất${s.failed > 0 ? `, ${s.failed} lỗi` : ''}`;
}

/** Chỉ khi mọi dòng đã `done` mới thôi tải lại; dòng lỗi vẫn có thể được thử lại. */
export function isBatchSettled(tokens: Pick<PublicToken, 'status'>[]): boolean {
  return tokens.every((t) => t.status === 'done');
}

/** Cập nhật lô bằng dữ liệu mới theo id token: giữ thứ tự lô, bỏ qua token ngoài lô. */
export function mergeBatch(batch: PublicToken[], fresh: PublicToken[]): PublicToken[] {
  const byId = new Map(fresh.map((t) => [t.id, t]));
  return batch.map((t) => byId.get(t.id) ?? t);
}
