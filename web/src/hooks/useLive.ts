import { useEffect, useRef } from 'react';

/** Kết nối SSE; mỗi khi server báo thay đổi thì gọi refetch (gộp các sự kiện dồn dập). */
export function useLive(enabled: boolean, refetch: () => void) {
  const ref = useRef(refetch);
  ref.current = refetch;
  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const es = new EventSource('/api/events');
    es.onmessage = () => {
      clearTimeout(timer);
      timer = setTimeout(() => ref.current(), 300);
    };
    return () => {
      clearTimeout(timer);
      es.close();
    };
  }, [enabled]);
}
