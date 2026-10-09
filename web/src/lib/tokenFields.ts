import type { PublicToken } from '../../../server/src/types';
import { shortAddr } from '../../../shared/units';

/** Mint đã xảy ra từ trước trên chain: không có tx mới, tuyệt đối không hiển thị như một mã giao dịch. */
export const ALREADY_MINTED = 'already-minted';
export const ALREADY_MINTED_NOTE = 'Đã mint trước đó (không có tx mới)';

export type FieldState =
  | { kind: 'value'; text: string; full?: string }
  | { kind: 'missing' }
  | { kind: 'pending' }
  | { kind: 'note'; text: string };

type TokenProgress = Pick<PublicToken, 'status' | 'failedStep'>;
export type ProducedStep = 'deploying' | 'minting';

/** Trường bắt buộc có ngay từ lúc tạo: null/rỗng nghĩa là dữ liệu hỏng, luôn báo "Thiếu". */
export function requiredField(v: string | null | undefined): FieldState {
  return v ? { kind: 'value', text: v } : { kind: 'missing' };
}

/**
 * Trường chỉ có sau một bước của quy trình; `step` là bước tạo ra nó.
 * Null chỉ là "Thiếu" khi bước đó đáng ra đã xong (token hoàn tất, hoặc lỗi ở bước sau nó);
 * ngược lại là "Đang chờ…".
 */
export function producedField(token: TokenProgress, step: ProducedStep, v: string | null, shorten: [number, number]): FieldState {
  if (v) return { kind: 'value', text: shortAddr(v, shorten[0], shorten[1]), full: v };
  const shouldExist = token.status === 'done' || (token.status === 'failed' && token.failedStep === 'minting' && step === 'deploying');
  return shouldExist ? { kind: 'missing' } : { kind: 'pending' };
}

/** Tx mint: giá trị đặc biệt "already-minted" là ghi chú (không có nút chép), còn lại theo luật producedField. */
export function mintTxField(token: TokenProgress & Pick<PublicToken, 'mintTxId'>): FieldState {
  if (token.mintTxId === ALREADY_MINTED) return { kind: 'note', text: ALREADY_MINTED_NOTE };
  return producedField(token, 'minting', token.mintTxId, [12, 8]);
}
