import { describe, expect, it } from 'vitest';
import { STATUS_LABEL, TOKEN_STATUS_LABEL, statusTone } from './labels';

describe('labels', () => {
  it('mọi trạng thái ví đều có nhãn tiếng Việt', () => {
    for (const s of ['created', 'funding', 'syncing', 'dust_pending', 'ready', 'failed'] as const) {
      expect(STATUS_LABEL[s]).toBeTruthy();
    }
  });
  it('mọi trạng thái token đều có nhãn', () => {
    for (const s of ['queued', 'deploying', 'minting', 'done', 'failed'] as const) {
      expect(TOKEN_STATUS_LABEL[s]).toBeTruthy();
    }
  });
  it('tông màu: ready/done là ok, failed là bad, còn lại là busy', () => {
    expect(statusTone('ready')).toBe('ok');
    expect(statusTone('done')).toBe('ok');
    expect(statusTone('failed')).toBe('bad');
    expect(statusTone('syncing')).toBe('busy');
    expect(statusTone('minting')).toBe('busy');
  });
});
