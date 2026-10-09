import { useCallback, useEffect, useState } from 'react';
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
  const [tab, setTab] = useState<Tab>('wallets');
  const [error, setError] = useState<string | null>(null);

  const unlocked = status?.unlocked ?? false;

  const loadStatus = useCallback(() => api.status().then(setStatus).catch((e) => setError(e.message)), []);
  const loadWallets = useCallback(() => api.wallets().then(setWallets).catch((e) => setError(e.message)), []);
  const loadDetail = useCallback(() => {
    if (!selectedId) return setDetail(null);
    api.wallet(selectedId).then(setDetail).catch(() => setDetail(null));
  }, [selectedId]);

  useEffect(() => { void loadStatus(); }, [loadStatus]);
  useEffect(() => { if (unlocked) void loadWallets(); }, [unlocked, loadWallets]);
  useEffect(() => { loadDetail(); }, [loadDetail]);
  useLive(unlocked, () => { void loadWallets(); loadDetail(); });

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

      <div className="body">
        <aside className="side" aria-label="Ví tổng và ví con">
          <TreasuryCard
            treasury={treasury}
            faucetUrl={status.faucetUrl}
            fundAmount={status.fundAmount}
            onChanged={loadWallets}
            onSelect={(id) => { setSelectedId(id); setTab('wallets'); }}
            onError={setError}
          />
          <WalletList
            wallets={children}
            selectedId={selectedId}
            onSelect={(id) => { setSelectedId(id); setTab('wallets'); }}
            onChanged={loadWallets}
            onError={setError}
          />
        </aside>
        <main className="main">
          {tab === 'wallets' ? (
            <WalletDetail
              key={selectedId ?? 'none'}
              data={detail && detail.wallet.id === selectedId ? detail : null}
              loading={selectedId !== null}
              faucetUrl={status.faucetUrl}
              onChanged={() => { void loadWallets(); loadDetail(); }}
              onError={setError}
            />
          ) : (
            <MintPanel
              wallets={children}
              onMinted={() => { void loadWallets(); loadDetail(); }}
              onError={setError}
            />
          )}
        </main>
      </div>
    </div>
  );
}
