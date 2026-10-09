import { useEffect, useState, type ReactNode } from 'react';
import type { PublicToken } from '../../../server/src/types';
import { formatUnits } from '../../../shared/units';
import { api } from '../api';
import { mintTxField, producedField, requiredField, type FieldState } from '../lib/tokenFields';
import { CopyButton } from './CopyButton';
import { StatusBadge } from './StatusBadge';

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

  return (
    <article className="token card">
      <TokenImage src={token.imageGatewayUrl} name={token.name} symbol={token.symbol} />
      <div className="token-body">
        <div className="row between">
          <h3>{token.name} <span className="muted">({token.symbol})</span></h3>
          <StatusBadge status={token.status} kind="token" />
        </div>
        <dl className="kv wide">
          <Field label="Name" state={requiredField(token.name)} />
          <Field label="Symbol" state={requiredField(token.symbol)} />
          <Field label="Decimals" state={requiredField(token.decimals == null ? null : String(token.decimals))} />
          <Field label="Số lượng" state={requiredField(token.baseUnits == null ? null : formatUnits(token.baseUnits, token.decimals))} />
          <Field label="Ảnh (IPFS)" state={requiredField(token.imageUri)} mono />
          <Field label="SHA-256 ảnh" state={requiredField(token.imageSha256)} mono />
          <Field label="Contract" state={producedField(token, 'deploying', token.contractAddress, [14, 10])} mono onError={onError} />
          <Field label="Màu token" state={producedField(token, 'minting', token.tokenColor, [14, 10])} mono onError={onError} />
          <Field label="Tx deploy" state={producedField(token, 'deploying', token.deployTxId, [12, 8])} mono onError={onError} />
          <Field label="Tx mint" state={mintTxField(token)} mono onError={onError} />
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
