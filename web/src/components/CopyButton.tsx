import { useEffect, useRef, useState } from 'react';

/** Nút chép giá trị đầy đủ vào clipboard; lỗi (không có quyền clipboard) được báo qua onError. */
export function CopyButton({ value, label, onError }: { value: string; label: string; onError?: (m: string) => void }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      onError?.('Trình duyệt không cho phép chép vào clipboard. Hãy bôi đen và chép thủ công.');
    }
  }

  return (
    <button type="button" className="btn tiny" onClick={copy} aria-label={`Chép ${label}`}>
      <span aria-live="polite">{copied ? 'Đã chép' : 'Chép'}</span>
    </button>
  );
}
