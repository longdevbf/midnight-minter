/**
 * Lỗi nghiệp vụ: điều kiện người dùng phải xử lý (thiếu tiền, thiếu DUST, ví chưa sẵn sàng, quá thời gian chờ).
 * Engine KHÔNG tự thử lại các lỗi này; chỉ lỗi tạm (mạng, SDK) ở bước syncing/dust_pending mới được tự thử lại.
 */
export class BusinessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BusinessError';
  }
}

/** Một lệnh gọi chuỗi quá thời gian chờ (ví đã bị đóng và bỏ khỏi bộ nhớ đệm). */
export class ChainTimeoutError extends BusinessError {
  constructor(message: string) {
    super(message);
    this.name = 'ChainTimeoutError';
  }
}
