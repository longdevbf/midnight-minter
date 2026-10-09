/**
 * Lỗi gửi giao dịch do kết nối WebSocket tới node RPC bị đóng giữa chừng ("disconnected from wss://… 1000 Normal Closure").
 * Đây là lỗi mạng chập chờn đo được trên preview: gửi lại sau vài giây là qua. Lỗi khác (giao dịch bị node từ chối) thì không thử lại.
 */
export function isTransientSubmitError(e: unknown): boolean {
  let cur: unknown = e;
  for (let i = 0; i < 8 && cur !== undefined && cur !== null; i++) {
    const msg = cur instanceof Error ? cur.message : String(cur);
    if (/disconnected from|socket (hang up|closed)|ECONNRESET|WebSocket is not connected/i.test(msg)) return true;
    cur = cur instanceof Error ? (cur as { cause?: unknown }).cause : undefined;
  }
  return false;
}

export async function submitWithRetry<T>(
  submit: () => Promise<T>,
  opts: { attempts?: number; delayMs?: number } = {},
): Promise<T> {
  const attempts = opts.attempts ?? 4;
  const delayMs = opts.delayMs ?? 3000;
  for (let n = 1; ; n++) {
    try {
      return await submit();
    } catch (e) {
      if (n >= attempts || !isTransientSubmitError(e)) throw e;
      console.warn(`Gửi giao dịch lỗi mạng (lần ${n}/${attempts}), thử lại sau ${(delayMs * n) / 1000}s`);
      await new Promise((r) => setTimeout(r, delayMs * n));
    }
  }
}
