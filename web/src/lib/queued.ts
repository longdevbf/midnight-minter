/** Kết quả của retry/refresh: queued=false nghĩa là việc cùng loại đang xếp hàng/đang chạy nên lệnh mới bị bỏ qua. */
export interface QueuedResult {
  ok: true;
  queued: boolean;
}

export const QUEUED_FALSE_INFO = 'Việc này đang chạy, đợi hoàn tất';

/** Thông báo cần hiện cho người dùng, hoặc null nếu việc đã được nhận. */
export function queuedInfo(r: QueuedResult): string | null {
  return r.queued ? null : QUEUED_FALSE_INFO;
}
