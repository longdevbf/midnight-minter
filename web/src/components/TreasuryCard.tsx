import { useState } from 'react';
import type { PublicWallet } from '../../../server/src/types';
import { DUST_DECIMALS, NIGHT_DECIMALS, formatUnits, shortAddr } from '../../../shared/units';
import { api } from '../api';
import { CopyButton } from './CopyButton';
import { StatusBadge } from './StatusBadge';

interface Props {
  treasury: PublicWallet | null;
  faucetUrl: string;
  fundAmount: string;
  onChanged: () => void;
  onSelect: (id: string) => void;
  onError: (m: string) => void;
}

export function TreasuryCard({ treasury, faucetUrl, fundAmount, onChanged, onSelect, onError }: Props) {
  const [busy, setBusy] = useState(false);

  async function create() {
    setBusy(true);
    try { await api.createWallets(1, 'treasury'); onChanged(); }
    catch (e) { onError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  async function retry(id: string) {
    try { await api.retryWallet(id); onChanged(); }
    catch (e) { onError(e instanceof Error ? e.message : String(e)); }
  }

  if (!treasury) {
    return (
      <section className="card" aria-labelledby="treasury-title">
        <h2 id="treasury-title">Ví tổng</h2>
        <p className="muted">
          Faucet có captcha nên không thể tự động. Tạo ví tổng, xin tNIGHT cho nó một lần bằng tay,
          rồi app tự cấp {formatUnits(fundAmount, NIGHT_DECIMALS)} tNIGHT cho từng ví con.
        </p>
        <button className="btn primary" onClick={create} disabled={busy}>{busy ? 'Đang tạo…' : 'Tạo ví tổng'}</button>
      </section>
    );
  }

  const waiting = treasury.status === 'funding' && treasury.failedStep === null;
  return (
    <section className="card" aria-labelledby="treasury-title">
      <div className="row between">
        <h2 id="treasury-title">Ví tổng</h2>
        <StatusBadge status={treasury.status} />
      </div>
      <button className="link" onClick={() => onSelect(treasury.id)} title={treasury.unshieldedAddress}>
        {shortAddr(treasury.unshieldedAddress, 16, 8)}
      </button>
      <dl className="kv">
        <dt>NIGHT</dt><dd className="num">{formatUnits(treasury.nightBalance, NIGHT_DECIMALS)}</dd>
        <dt>DUST</dt><dd className="num">{formatUnits(treasury.dustBalance, DUST_DECIMALS)}</dd>
      </dl>
      {/* Luôn hiện (không chỉ khi đang chờ) để nạp thêm tNIGHT khi ví tổng sắp cạn. */}
      <div className={waiting ? 'hint' : undefined}>
        <p className={waiting ? undefined : 'muted small'}>
          {waiting ? 'Xin tNIGHT cho địa chỉ này (cần giải captcha):' : 'Nạp thêm tNIGHT cho ví tổng (cần giải captcha):'}
        </p>
        <div className="row">
          <CopyButton value={treasury.unshieldedAddress} label="địa chỉ ví tổng" onError={onError} />
          <a className="btn" href={faucetUrl} target="_blank" rel="noreferrer">Mở faucet</a>
        </div>
        {waiting && <p className="muted small">App tự phát hiện khi tiền về.</p>}
      </div>
      {treasury.status === 'failed' && (
        <div className="hint bad">
          <p>{treasury.message}</p>
          <button className="btn" onClick={() => void retry(treasury.id)}>Thử lại</button>
        </div>
      )}
    </section>
  );
}
