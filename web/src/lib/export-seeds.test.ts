import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import { exportFilename, exportJson, type ExportedWallet } from './export-seeds';

afterEach(() => vi.unstubAllGlobals());

const row: ExportedWallet = { label: 'Ví 1', kind: 'child', network: 'preview', unshieldedAddress: 'mn_addr_preview1abc', mnemonic: 'a b c' };

describe('export-seeds', () => {
  it('exportJson giữ thứ tự và đủ trường, kết thúc bằng xuống dòng', () => {
    const text = exportJson([row, { ...row, label: 'Ví 2' }]);
    expect(text.endsWith('\n')).toBe(true);
    const parsed = JSON.parse(text) as ExportedWallet[];
    expect(parsed.map((r) => r.label)).toEqual(['Ví 1', 'Ví 2']);
    expect(Object.keys(parsed[0]).sort()).toEqual(['kind', 'label', 'mnemonic', 'network', 'unshieldedAddress']);
  });

  it('exportFilename theo ngày UTC', () => {
    expect(exportFilename(new Date('2026-10-09T10:00:00Z'))).toBe('midnight-minter-seedphrase-2026-10-09.json');
  });

  it('api.exportSeeds gửi mật khẩu bằng POST /api/export', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify([row]), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await api.exportSeeds('mat-khau-chu-123')).toEqual([row]);
    const [path, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(path).toBe('/api/export');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ password: 'mat-khau-chu-123' });
  });
});
