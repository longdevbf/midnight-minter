import { inspect } from 'node:util';

export const MASK = '***';

/** `project_id=<giá trị>` trong URL (khóa Blockfrost); giá trị kết thúc ở &, khoảng trắng hoặc dấu nháy. */
const PROJECT_ID_RE = /(project_id=)[^&\s"'`]*/gi;

/**
 * Tạo hàm che bí mật trong chuỗi: mọi lần xuất hiện của từng bí mật (và dạng `encodeURIComponent` của nó)
 * thành `***`, và mọi `project_id=<...>` thành `project_id=***`. Bí mật rỗng/thiếu bị bỏ qua.
 * Kết quả ổn định: che lại một chuỗi đã che không đổi gì.
 */
export function makeRedactor(secrets: ReadonlyArray<string | null | undefined>): (s: string) => string {
  const needles = new Set<string>();
  for (const raw of secrets) {
    const s = raw?.trim();
    if (!s) continue;
    needles.add(s);
    needles.add(encodeURIComponent(s));
  }
  needles.delete(MASK);
  // Dài trước: bí mật này chứa bí mật kia thì che trọn chuỗi dài, không để lòi đuôi.
  const ordered = [...needles].sort((a, b) => b.length - a.length);
  return (input: string) => {
    let out = input;
    for (const n of ordered) if (out.includes(n)) out = out.split(n).join(MASK);
    return out.replace(PROJECT_ID_RE, `$1${MASK}`);
  };
}

const METHODS = ['log', 'info', 'warn', 'error', 'debug'] as const;
type ConsoleLike = Pick<Console, (typeof METHODS)[number]>;

/** Chuyển một đối số console thành dạng an toàn để che: chuỗi giữ nguyên, Error/đối tượng qua inspect (chịu vòng lặp). */
function toRedactable(arg: unknown, redact: (s: string) => string): unknown {
  if (typeof arg === 'string') return redact(arg);
  if (arg instanceof Error || (typeof arg === 'object' && arg !== null)) {
    try {
      return redact(inspect(arg, { depth: 4, breakLength: Infinity }));
    } catch {
      return redact(Object.prototype.toString.call(arg));
    }
  }
  return arg; // số, boolean, undefined, symbol... không chứa bí mật dạng chuỗi
}

/**
 * Bọc console.log/info/warn/error/debug để mọi chuỗi (kể cả message/stack của Error và đối tượng đã chuyển
 * thành chuỗi) đi qua `redact` trước khi in. Trả hàm khôi phục các phương thức gốc.
 */
export function installConsoleRedaction(redact: (s: string) => string, target: ConsoleLike = console): () => void {
  const originals = METHODS.map((m) => [m, target[m]] as const);
  for (const [m, orig] of originals) {
    target[m] = (...args: unknown[]) => orig.apply(target, args.map((a) => toRedactable(a, redact)));
  }
  return () => {
    for (const [m, orig] of originals) target[m] = orig;
  };
}
