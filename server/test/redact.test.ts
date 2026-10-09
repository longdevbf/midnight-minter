import { describe, expect, it, vi } from 'vitest';
import { installConsoleRedaction, makeRedactor } from '../src/lib/redact';

const KEY = 'previewAbCdEf0123456789xyz';
const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.sig+/=';

describe('makeRedactor', () => {
  it('che khóa xuất hiện trần, nhiều lần', () => {
    const r = makeRedactor([KEY]);
    expect(r(`key ${KEY} và lần nữa ${KEY}.`)).toBe('key *** và lần nữa ***.');
  });

  it('che dạng URL-encoded của bí mật', () => {
    const r = makeRedactor([JWT]);
    const enc = encodeURIComponent(JWT);
    expect(enc).not.toBe(JWT);
    const out = r(`Authorization: Bearer ${JWT} url=?t=${enc}`);
    expect(out).toBe('Authorization: Bearer *** url=?t=***');
    expect(out).not.toContain('eyJhbGci');
  });

  it('che project_id=<bất kỳ> (kể cả khóa không biết trước), dừng ở & khoảng trắng hoặc nháy', () => {
    const r = makeRedactor([]);
    expect(r('wss://rpc.x.io?project_id=abc&foo=1')).toBe('wss://rpc.x.io?project_id=***&foo=1');
    expect(r('GET /ws?project_id=abc def')).toBe('GET /ws?project_id=*** def');
    expect(r(`"https://x/?project_id=abc"`)).toBe(`"https://x/?project_id=***"`);
    expect(r('PROJECT_ID=abc')).toBe('PROJECT_ID=***');
  });

  it('URL Blockfrost thật: khóa bị che đúng một lần, không thành ******', () => {
    const r = makeRedactor([KEY, JWT]);
    const out = r(`API-WS: disconnected from wss://rpc.midnight-preprod.blockfrost.io?project_id=${KEY} (1006)`);
    expect(out).toBe('API-WS: disconnected from wss://rpc.midnight-preprod.blockfrost.io?project_id=*** (1006)');
    expect(out).not.toContain(KEY);
    expect(out).not.toContain('******');
  });

  it('ổn định: che hai lần cho cùng kết quả', () => {
    const r = makeRedactor([KEY, JWT]);
    const s = `a ${KEY} b ${encodeURIComponent(JWT)} c ?project_id=${KEY}&x=1`;
    expect(r(r(s))).toBe(r(s));
  });

  it('bí mật rỗng/khoảng trắng/undefined bị bỏ qua (không che mọi chỗ)', () => {
    const r = makeRedactor(['', '   ', undefined, null]);
    expect(r('chuỗi bình thường')).toBe('chuỗi bình thường');
  });

  it('bí mật dài chứa bí mật ngắn: che trọn, không lòi đuôi', () => {
    const r = makeRedactor(['abc', 'abcdef123']);
    expect(r('x abcdef123 y abc')).toBe('x *** y ***');
  });
});

function fakeConsole() {
  return { log: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

describe('installConsoleRedaction', () => {
  const redact = makeRedactor([KEY]);

  it('che chuỗi ở mọi phương thức log/info/warn/error/debug', () => {
    const c = fakeConsole();
    const spies = { ...c };
    const restore = installConsoleRedaction(redact, c as unknown as Console);
    for (const m of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      c[m](`[${m}] key=${KEY}`, 42);
      expect(spies[m]).toHaveBeenCalledWith(`[${m}] key=***`, 42);
    }
    restore();
  });

  it('che message và stack của Error', () => {
    const c = fakeConsole();
    const spy = c.error;
    const restore = installConsoleRedaction(redact, c as unknown as Console);
    const e = new Error(`không kết nối được wss://x?project_id=${KEY}`);
    c.error('Lỗi:', e);
    const printed = spy.mock.calls[0].map(String).join(' ');
    expect(printed).not.toContain(KEY);
    expect(printed).toContain('project_id=***');
    expect(printed).toContain('Error'); // vẫn có stack/tên lỗi để gỡ lỗi
    expect(e.message).toContain(KEY); // không sửa đối tượng lỗi gốc
    restore();
  });

  it('che bí mật trong đối tượng (kể cả lồng nhau và vòng lặp)', () => {
    const c = fakeConsole();
    const spy = c.warn;
    const restore = installConsoleRedaction(redact, c as unknown as Console);
    const o: Record<string, unknown> = { url: `https://x/?project_id=${KEY}`, nested: { k: KEY } };
    o.self = o;
    c.warn(o);
    const printed = String(spy.mock.calls[0]?.[0] ?? '');
    expect(printed).toContain('project_id=***');
    expect(printed).not.toContain(KEY);
    restore();
  });

  it('hàm trả về khôi phục phương thức gốc', () => {
    const c = fakeConsole();
    const orig = { ...c };
    const restore = installConsoleRedaction(redact, c as unknown as Console);
    expect(c.log).not.toBe(orig.log);
    restore();
    for (const m of ['log', 'info', 'warn', 'error', 'debug'] as const) expect(c[m]).toBe(orig[m]);
  });

  it('mặc định bọc console toàn cục', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const restore = installConsoleRedaction(redact);
    try {
      console.log(`x ${KEY}`);
      expect(spy).toHaveBeenCalledWith('x ***');
    } finally {
      restore();
      spy.mockRestore();
    }
  });
});
