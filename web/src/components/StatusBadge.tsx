import type { TokenStatus, WalletStatus } from '../../../server/src/types';
import { STATUS_LABEL, TOKEN_STATUS_LABEL, statusTone } from '../lib/labels';

const GLYPH = { ok: '✓', bad: '!' } as const;

/** Trạng thái luôn có chữ; biểu tượng và màu chỉ là phần bổ trợ. */
export function StatusBadge({ status, kind = 'wallet' }: { status: WalletStatus | TokenStatus; kind?: 'wallet' | 'token' }) {
  const label = kind === 'wallet' ? STATUS_LABEL[status as WalletStatus] : TOKEN_STATUS_LABEL[status as TokenStatus];
  const tone = statusTone(status);
  return (
    <span className={`badge ${tone}`}>
      {tone === 'busy' ? <span className="spin" aria-hidden="true" /> : <span className="glyph" aria-hidden="true">{GLYPH[tone]}</span>}
      {label}
    </span>
  );
}
