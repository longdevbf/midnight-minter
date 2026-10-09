import { useState } from 'react';
import { api } from '../api';
import { exportFilename, exportJson } from '../lib/export-seeds';

/** Xuất toàn bộ seedphrase ra file JSON. Mnemonic chỉ tồn tại trong biến cục bộ lúc tạo file, không vào state. */
export function ExportSeeds({ onError }: { onError: (m: string) => void }) {
  const [asking, setAsking] = useState(false);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  async function download() {
    setBusy(true);
    try {
      const rows = await api.exportSeeds(password);
      const url = URL.createObjectURL(new Blob([exportJson(rows)], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = exportFilename();
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000); // sau khi trình duyệt đã bắt đầu tải
      setAsking(false);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setPassword('');
      setBusy(false);
    }
  }

  if (!asking) {
    return (
      <div className="export-seeds">
        <button type="button" className="btn" onClick={() => setAsking(true)}>Xuất toàn bộ seedphrase</button>
      </div>
    );
  }
  return (
    <form className="export-seeds stack" onSubmit={(e) => { e.preventDefault(); void download(); }}>
      <p className="hint bad small">File chứa seedphrase của MỌI ví. Ai có file này là có toàn quyền với các ví. Cất ở nơi an toàn và xóa khi không cần.</p>
      <div className="row">
        <input
          type="password" autoFocus aria-label="Mật khẩu chủ" placeholder="Mật khẩu chủ"
          autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)}
        />
        <button className="btn primary" disabled={busy || password.length === 0}>{busy ? 'Đang xuất…' : 'Tải về'}</button>
        <button type="button" className="btn" disabled={busy} onClick={() => { setAsking(false); setPassword(''); }}>Hủy</button>
      </div>
    </form>
  );
}
