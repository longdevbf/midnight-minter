import { useCallback, useEffect, useRef, useState } from 'react';
import type { PublicToken, PublicWallet } from '../../server/src/types';
import { api, type Status } from './api';
import { Unlock } from './components/Unlock';
import { WalletList } from './components/WalletList';
import { WalletDetail } from './components/WalletDetail';
import { TreasuryCard } from './components/TreasuryCard';
import { MintPanel } from './components/MintPanel';
import { useLive } from './hooks/useLive';

type Tab = 'wallets' | 'mint';

export function App() {
  const [status, setStatus] = useState<Status | null>(null);
  const [wallets, setWallets] = useState<PublicWallet[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ wallet: PublicWallet; tokens: PublicToken[] } | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('wallets');
  const [error, setError] = useState<string | null>(null);
  /** Thông báo không phải lỗi (ví dụ: việc đang chạy nên lệnh thử lại bị bỏ qua). */
  const [info, setInfo] = useState<string | null>(null);
  /** Tăng mỗi lần server báo thay đổi; MintPanel dùng để làm mới bảng tiến trình. */
  const [liveTick, setLiveTick] = useState(0);
  /** Đếm request chi tiết: chỉ request mới nhất của lựa chọn hiện tại được phép ghi state. */
  const detailSeq = useRef(0);
  const detailRef = useRef(detail);
  detailRef.current = detail;

  const unlocked = status?.unlocked ?? false;
  const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

  const loadStatus = useCallback(async () => {
    try {
      const s = await api.status();
      setStatus(s);
      return s;
    } catch (e) {
      setError(message(e));
      return null;
    }
  }, []);
  const loadWallets = useCallback(() => api.wallets().then(setWallets).catch((e) => setError(message(e))), []);
  const loadDetail = useCallback(() => {
    const seq = ++detailSeq.current;
    if (!selectedId) {
      setDetail(null);
      setDetailError(null);
      return;
    }
    const id = selectedId;
    api.wallet(id).then((d) => {
      if (seq !== detailSeq.current) return; // đã có request mới hơn hoặc đã đổi ví
      setDetail(d);
      setDetailError(null);
    }).catch((e) => {
      if (seq !== detailSeq.current) return;
      // Không xóa chi tiết đang hiển thị khi refetch lỗi thoáng qua; chỉ báo lỗi.
      const msg = 'Không tải được chi tiết ví: ' + message(e);
      if (detailRef.current?.wallet.id === id) setError(msg);
      else setDetailError(msg);
    });
  }, [selectedId]);

  const select = (id: string) => {
    if (id !== selectedId) {
      setDetail(null); // không bao giờ để dữ liệu của ví trước hiện ra
      setDetailError(null);
    }
    setSelectedId(id);
    setTab('wallets');
  };

  useEffect(() => { void loadStatus(); }, [loadStatus]);
  useEffect(() => { if (unlocked) void loadWallets(); }, [unlocked, loadWallets]);
  useEffect(() => { loadDetail(); }, [loadDetail]);
  useLive(unlocked, () => { void loadWallets(); loadDetail(); setLiveTick((t) => t + 1); });

  // 401: có thể do server khởi động lại nên phiên bị khóa. Hỏi lại trạng thái; nếu đã khóa thì về màn hình mở khóa.
  useEffect(() => {
    api.onUnauthorized(() => {
      void loadStatus().then((s) => {
        if (s && !s.unlocked) {
          detailSeq.current++;
          setSelectedId(null);
          setDetail(null);
          setDetailError(null);
          setWallets([]);
          setError(null);
        }
      });
    });
    return () => api.onUnauthorized(null);
  }, [loadStatus]);

  if (!status) return <div className="center muted" role="status">{error ?? 'Đang tải…'}</div>;
  if (!unlocked) return <Unlock initialized={status.initialized} onDone={loadStatus} />;

  const treasury = wallets.find((w) => w.kind === 'treasury') ?? null;
  const children = wallets.filter((w) => w.kind === 'child');

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">◐</span>
          <span>Midnight Minter</span>
        </div>
        <nav className="tabs" aria-label="Chức năng">
          <button className={tab === 'wallets' ? 'tab active' : 'tab'} aria-current={tab === 'wallets' ? 'page' : undefined} onClick={() => setTab('wallets')}>Ví</button>
          <button className={tab === 'mint' ? 'tab active' : 'tab'} aria-current={tab === 'mint' ? 'page' : undefined} onClick={() => setTab('mint')}>Mint token</button>
        </nav>
        <span className={`net net-${status.network}`} title="Mạng đang kết nối">Mạng: {status.network}</span>
      </header>

      {error && (
        <div className="banner bad" role="alert">
          <span>{error}</span>
          <button className="btn tiny" onClick={() => setError(null)}>Đóng</button>
        </div>
      )}

      {info && (
        <div className="banner info" role="status">
          <span>{info}</span>
          <button className="btn tiny" onClick={() => setInfo(null)}>Đóng</button>
        </div>
      )}

      <div className="body">
        <aside className="side" aria-label="Ví tổng và ví con">
          <TreasuryCard
            treasury={treasury}
            faucetUrl={status.faucetUrl}
            fundAmount={status.fundAmount}
            onChanged={loadWallets}
            onSelect={select}
            onError={setError}
          />
          <WalletList
            wallets={children}
            selectedId={selectedId}
            onSelect={select}
            onChanged={loadWallets}
            onError={setError}
          />
        </aside>
        <main className="main">
          {tab === 'wallets' && (
            <WalletDetail
              key={selectedId ?? 'none'}
              data={detail && detail.wallet.id === selectedId ? detail : null}
              loading={selectedId !== null}
              loadError={detailError}
              onReload={() => { setDetailError(null); loadDetail(); }}
              faucetUrl={status.faucetUrl}
              onChanged={() => { void loadWallets(); loadDetail(); }}
              onError={setError}
              onInfo={setInfo}
            />
          )}
          {/* Luôn gắn sẵn (chỉ ẩn khi ở tab khác) để form và bảng tiến trình không mất khi đổi tab. */}
          <div hidden={tab !== 'mint'}>
            <MintPanel
              wallets={children}
              onMinted={() => { void loadWallets(); loadDetail(); }}
              onError={setError}
              onInfo={setInfo}
              liveTick={liveTick}
            />
          </div>
        </main>
      </div>
    </div>
  );
}
