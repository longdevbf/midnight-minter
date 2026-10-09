import { useState } from 'react';
import type { PublicWallet } from '../../../server/src/types';
import { DUST_DECIMALS, NIGHT_DECIMALS, formatUnits, shortAddr } from '../../../shared/units';
import { api } from '../api';
import { formatCompactUnits } from '../lib/format';
import { statusTone } from '../lib/labels';
import { StatusBadge } from './StatusBadge';

interface Props {
  wallets: PublicWallet[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onChanged: () => void;
  onError: (m: string) => void;
}

export function WalletList({ wallets, selectedId, onSelect, onChanged, onError }: Props) {
  const [count, setCount] = useState(1);
  const [busy, setBusy] = useState(false);

  async function create() {
    setBusy(true);
    try { await api.createWallets(count, 'child'); onChanged(); }
    catch (e) { onError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  return (
    <section className="card grow" aria-labelledby="children-title">
      <div className="row between">
        <h2 id="children-title">Ví con <span className="muted">({wallets.length})</span></h2>
      </div>
      <div className="row create">
        <input
          type="number" min={1} max={50} value={count} aria-label="Số ví cần tạo"
          onChange={(e) => setCount(Math.max(1, Math.min(50, Number(e.target.value) || 1)))}
        />
        <button className="btn primary" onClick={create} disabled={busy}>
          {busy ? 'Đang tạo…' : count === 1 ? 'Tạo ví mới' : `Tạo ${count} ví`}
        </button>
      </div>
      <ul className="wallets" aria-label="Danh sách ví">
        {wallets.length === 0 && <li className="muted empty">Chưa có ví nào. Chọn số lượng rồi bấm tạo ví.</li>}
        {wallets.map((w) => (
          <li key={w.id}>
            <button
              className={w.id === selectedId ? 'wallet selected' : 'wallet'}
              data-tone={statusTone(w.status)}
              aria-current={w.id === selectedId ? 'true' : undefined}
              onClick={() => onSelect(w.id)}
            >
              <div className="row between nowrap">
                <strong className="ellipsis">{w.label}</strong>
                <StatusBadge status={w.status} />
              </div>
              <div className="mono small muted" title={w.unshieldedAddress}>{shortAddr(w.unshieldedAddress, 16, 6)}</div>
              <div className="stats small">
                <span>NIGHT <b className="num">{formatUnits(w.nightBalance, NIGHT_DECIMALS)}</b></span>
                <span>DUST <b className="num">{formatCompactUnits(w.dustBalance, DUST_DECIMALS, 6)}</b></span>
                <span><b className="num">{w.tokenCount}</b> token</span>
              </div>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
