import { useState, type FormEvent } from 'react';
import { api } from '../api';

export function Unlock({ initialized, onDone }: { initialized: boolean; onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!initialized && password !== confirm) return setError('Hai lần nhập mật khẩu không khớp');
    setBusy(true);
    try {
      await api.unlock(password);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="center">
      <form className="card unlock" onSubmit={submit}>
        <h1><span className="brand-mark" aria-hidden="true">◐</span> Midnight Minter</h1>
        <p className="muted">
          {initialized
            ? 'Nhập mật khẩu chủ để mở khóa các ví.'
            : 'Lần đầu sử dụng: đặt mật khẩu chủ để mã hóa seedphrase của các ví. Mật khẩu này không thể khôi phục nếu quên.'}
        </p>
        <label>Mật khẩu chủ
          <input
            type="password" autoFocus value={password} minLength={8} required
            autoComplete={initialized ? 'current-password' : 'new-password'}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {!initialized && (
          <label>Nhập lại mật khẩu
            <input type="password" value={confirm} minLength={8} required autoComplete="new-password" onChange={(e) => setConfirm(e.target.value)} />
          </label>
        )}
        {error && <div className="banner bad" role="alert">{error}</div>}
        <button className="btn primary" disabled={busy}>{busy ? 'Đang mở khóa…' : initialized ? 'Mở khóa' : 'Thiết lập và mở khóa'}</button>
      </form>
    </div>
  );
}
