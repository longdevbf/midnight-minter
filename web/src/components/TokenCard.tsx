import { useEffect, useState, type ReactNode } from 'react';
import type { PublicToken } from '../../../server/src/types';
import { formatUnits, shortAddr } from '../../../shared/units';
import { api } from '../api';
import { CopyButton } from './CopyButton';
import { StatusBadge } from './StatusBadge';

/** Mint đã xảy ra từ trước trên chain: không có tx mới, tuyệt đối không hiển thị như một mã giao dịch. */
const ALREADY_MINTED = 'already-minted';

type FieldState =
  | { kind: 'value'; text: string; full?: string }
  | { kind: 'missing' }
  | { kind: 'pending' }
  | { kind: 'note'; text: string };

function Field({ label, state, mono, onError }: { label: string; state: FieldState; mono?: boolean; onError?: (m: string) => void }) {
  let body: ReactNode;
  if (state.kind === 'value') {
    body = (
      <>
        <span title={state.full ?? state.text}>{state.text}</span>
        {state.full && <CopyButton value={state.full} label={label} onError={onError} />}
      </>
    );
  } else if (state.kind === 'missing') body = <span className="missing">Thiếu</span>;
  else if (state.kind === 'pending') body = <span className="muted">Đang chờ…</span>;
  else body = <span className="muted">{state.text}</span>;
  return (
    <>
      <dt>{label}</dt>
      <dd className={mono ? 'mono field' : 'field'}>{body}</dd>
    </>
  );
}

/** Trường bắt buộc có ngay từ lúc tạo: null nghĩa là dữ liệu hỏng, luôn báo "Thiếu". */
const required = (v: string | null | undefined): FieldState =>
  v ? { kind: 'value', text: v } : { kind: 'missing' };

/**
 * Trường chỉ có sau một bước của quy trình; `step` là bước tạo ra nó.
 * Null chỉ là "Thiếu" khi bước đó đáng ra đã xong (token hoàn tất, hoặc lỗi ở bước sau nó);
 * ngược lại là "Đang chờ…".
 */
function produced(token: PublicToken, step: 'deploying' | 'minting', v: string | null, shorten: [number, number]): FieldState {
  if (v) return { kind: 'value', text: shortAddr(v, shorten[0], shorten[1]), full: v };
  const shouldExist = token.status === 'done' || (token.status === 'failed' && token.failedStep === 'minting' && step === 'deploying');
  return shouldExist ? { kind: 'missing' } : { kind: 'pending' };
}

function TokenImage({ src, name, symbol }: { src: string; name: string; symbol: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  if (failed || !src) {
    return (
      <div className="token-img placeholder" role="img" aria-label={`Chưa tải được ảnh token ${name}`}>
        {symbol.slice(0, 2).toUpperCase() || '?'}
      </div>
    );
  }
  return (
    <img
      className="token-img" src={src} alt={`Ảnh token ${name}`} loading="lazy"
      referrerPolicy="no-referrer" onError={() => setFailed(true)}
    />
  );
}

export function TokenCard({ token, onChanged, onError }: { token: PublicToken; onChanged: () => void; onError?: (m: string) => void }) {
  async function retry() {
    try { await api.retryToken(token.id); onChanged(); }
    catch (e) { onError?.(e instanceof Error ? e.message : String(e)); }
  }

  const mintTx: FieldState = token.mintTxId === ALREADY_MINTED
    ? { kind: 'note', text: 'Đã mint trước đó (không có tx mới)' }
    : produced(token, 'minting', token.mintTxId, [12, 8]);

  return (
    <article className="token card">
      <TokenImage src={token.imageGatewayUrl} name={token.name} symbol={token.symbol} />
      <div className="token-body">
        <div className="row between">
          <h3>{token.name} <span className="muted">({token.symbol})</span></h3>
          <StatusBadge status={token.status} kind="token" />
        </div>
        <dl className="kv wide">
          <Field label="Name" state={required(token.name)} />
          <Field label="Symbol" state={required(token.symbol)} />
          <Field label="Decimals" state={required(token.decimals == null ? null : String(token.decimals))} />
          <Field label="Số lượng" state={required(token.baseUnits == null ? null : formatUnits(token.baseUnits, token.decimals))} />
          <Field label="Ảnh (IPFS)" state={required(token.imageUri)} mono />
          <Field label="SHA-256 ảnh" state={required(token.imageSha256)} mono />
          <Field label="Contract" state={produced(token, 'deploying', token.contractAddress, [14, 10])} mono onError={onError} />
          <Field label="Màu token" state={produced(token, 'minting', token.tokenColor, [14, 10])} mono onError={onError} />
          <Field label="Tx deploy" state={produced(token, 'deploying', token.deployTxId, [12, 8])} mono onError={onError} />
          <Field label="Tx mint" state={mintTx} mono onError={onError} />
        </dl>
        {token.status === 'failed' && (
          <div className="hint bad">
            <p>{token.message}</p>
            <button className="btn" onClick={() => void retry()}>Thử lại từ bước {token.failedStep === 'minting' ? 'mint' : 'deploy'}</button>
          </div>
        )}
      </div>
    </article>
  );
}
