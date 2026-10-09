import { useState } from 'react';
import type { PublicToken, PublicWallet } from '../../../server/src/types';
import { DUST_DECIMALS, NIGHT_DECIMALS, formatUnits } from '../../../shared/units';
import { api } from '../api';
import { CopyButton } from './CopyButton';
import { StatusBadge } from './StatusBadge';
import { TokenCard } from './TokenCard';

interface Props {
  data: { wallet: PublicWallet; tokens: PublicToken[] } | null;
  /** Đã chọn một ví nhưng dữ liệu chi tiết chưa về. */
  loading?: boolean;
  faucetUrl: string;
  onChanged: () => void;
  onError: (m: string) => void;
}

export function WalletDetail({ data, loading = false, faucetUrl, onChanged, onError }: Props) {
  const [seed, setSeed] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [password, setPassword] = useState('');

  if (!data) {
    return (
      <div className="card empty-state" aria-busy={loading}>
        <p className="muted">{loading ? 'Đang tải ví…' : 'Chọn một ví ở bên trái để xem token của ví đó.'}</p>
      </div>
    );
  }
  const { wallet: w, tokens } = data;

  const fail = (e: unknown) => onError(e instanceof Error ? e.message : String(e));

  async function reveal() {
    try {
      const r = await api.seed(w.id, password);
      setSeed(r.mnemonic);
      setAsking(false);
      setPassword('');
    } catch (e) {
      fail(e);
    }
  }

  async function act(run: () => Promise<unknown>) {
    try { await run(); onChanged(); } catch (e) { fail(e); }
  }

  return (
    <div className="stack">
      <section className="card" aria-labelledby="wallet-title">
        <div className="row between">
          <div className="grow-text">
            <h2 id="wallet-title">{w.label}</h2>
            <div className="row addr">
              <div className="mono small copyable" title="Địa chỉ unshielded">{w.unshieldedAddress}</div>
              <CopyButton value={w.unshieldedAddress} label="địa chỉ ví" onError={onError} />
            </div>
          </div>
          <StatusBadge status={w.status} />
        </div>
        <dl className="kv wide">
          <dt>Mạng</dt><dd>{w.network}</dd>
          <dt>NIGHT</dt><dd className="num">{formatUnits(w.nightBalance, NIGHT_DECIMALS)}</dd>
          <dt>DUST</dt><dd className="num">{formatUnits(w.dustBalance, DUST_DECIMALS)}</dd>
          <dt>Số token</dt><dd className="num">{tokens.length}</dd>
        </dl>
        {w.message && w.status !== 'ready' && <div className={w.status === 'failed' ? 'hint bad' : 'hint'}><p>{w.message}</p></div>}
        <div className="row">
          <button className="btn" onClick={() => void act(() => api.refreshWallet(w.id))}>Làm mới số dư</button>
          {(w.status === 'failed' || w.status === 'funding') && <button className="btn" onClick={() => void act(() => api.retryWallet(w.id))}>Thử lại</button>}
          <button className="btn" onClick={() => (seed ? setSeed(null) : setAsking(true))}>{seed ? 'Ẩn seedphrase' : 'Xem seedphrase'}</button>
          <a className="btn" href={faucetUrl} target="_blank" rel="noreferrer">Faucet</a>
        </div>
        {asking && (
          <form className="row" onSubmit={(e) => { e.preventDefault(); void reveal(); }}>
            <input
              type="password" autoFocus aria-label="Mật khẩu chủ" placeholder="Mật khẩu chủ"
              autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)}
            />
            <button className="btn primary">Hiện</button>
            <button type="button" className="btn" onClick={() => { setAsking(false); setPassword(''); }}>Hủy</button>
          </form>
        )}
        {seed && (
          <div className="seed" role="note">
            <p className="small">Giữ bí mật. Ai có 24 từ này là có toàn quyền với ví.</p>
            <ol>{seed.split(' ').map((word, i) => <li key={i}>{word}</li>)}</ol>
          </div>
        )}
      </section>

      <section aria-labelledby="tokens-title">
        <h2 id="tokens-title" className="section-title">Token của ví này <span className="muted">({tokens.length})</span></h2>
        {tokens.length === 0
          ? <div className="card empty-state"><p className="muted">Ví chưa có token nào. Qua tab "Mint token" để tạo.</p></div>
          : <div className="stack">{tokens.map((t) => <TokenCard key={t.id} token={t} onChanged={onChanged} onError={onError} />)}</div>}
      </section>
    </div>
  );
}
