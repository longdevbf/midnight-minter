import type { PublicWallet } from '../../../server/src/types';

export function MintPanel(_: { wallets: PublicWallet[]; onMinted: () => void; onError: (m: string) => void }) {
  return <div className="card"><p className="muted">Sẽ làm ở Task 13.</p></div>;
}
