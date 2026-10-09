import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { PublicToken, PublicWallet } from '../../../server/src/types';
import { api } from '../api';
import { planNames, validateImageFile, validateRows, validateTemplate, type Overrides } from '../lib/mint-plan';
import { isBatchSettled, mergeBatch, stepStates, summarize, summaryText, type StepState } from '../lib/mint-progress';
import { StatusBadge } from './StatusBadge';

interface Props {
  wallets: PublicWallet[];
  onMinted: () => void;
  onError: (m: string) => void;
  /** Tăng mỗi lần server báo có thay đổi (SSE); dùng để làm mới bảng tiến trình. */
  liveTick: number;
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

const STEP_GLYPH: Record<StepState, string> = { pending: '○', active: '◔', done: '✓', failed: '!' };
const STEP_TEXT: Record<StepState, string> = { pending: 'chờ', active: 'đang chạy', done: 'xong', failed: 'lỗi' };

/** Một ô nhập có nhãn thật và thông báo lỗi gắn bằng aria-describedby. */
function Field({ label, error, hint, children }: {
  label: string;
  error?: string;
  hint?: string;
  children: (a: { id: string; 'aria-invalid': boolean; 'aria-describedby'?: string }) => ReactNode;
}) {
  const id = useId();
  const errId = `${id}-err`;
  const hintId = `${id}-hint`;
  const describedBy = [error ? errId : null, hint ? hintId : null].filter(Boolean).join(' ') || undefined;
  return (
    <div className="fieldwrap">
      <label htmlFor={id}>{label}</label>
      {children({ id, 'aria-invalid': Boolean(error), 'aria-describedby': describedBy })}
      {hint && <p id={hintId} className="muted small">{hint}</p>}
      {error && <p id={errId} className="field-error">{error}</p>}
    </div>
  );
}

export function MintPanel({ wallets, onMinted, onError, liveTick }: Props) {
  const ready = wallets.filter((w) => w.status === 'ready');
  const [selected, setSelected] = useState<string[]>([]);
  const [name, setName] = useState('Papa Coin #{n}');
  const [symbol, setSymbol] = useState('PAPA{n}');
  const [decimalsText, setDecimalsText] = useState('6');
  const [amount, setAmount] = useState('1000000');
  const [image, setImage] = useState<File | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<Overrides>({});
  const [busy, setBusy] = useState(false);
  const [batch, setBatch] = useState<PublicToken[]>([]);
  const [retrying, setRetrying] = useState<string[]>([]);

  const fileRef = useRef<HTMLInputElement>(null);
  const submitting = useRef(false);
  const mounted = useRef(true);
  const refreshSeq = useRef(0);
  const batchRef = useRef(batch);
  batchRef.current = batch;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const baseId = useId();

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  // Ảnh xem trước: tạo object URL khi đổi ảnh và thu hồi ngay khi ảnh đổi hoặc component bị gỡ.
  useEffect(() => {
    if (!image) { setPreviewUrl(null); return; }
    const url = URL.createObjectURL(image);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [image]);

  // Thứ tự ví theo danh sách (không theo thứ tự bấm) để {n} luôn dễ đoán; ví không còn Sẵn sàng tự rơi khỏi lô.
  const chosen = ready.filter((w) => selected.includes(w.id)).map((w) => w.id);
  const decimals = decimalsText.trim() === '' ? Number.NaN : Number(decimalsText);
  const template = { name, symbol, decimals, amount };
  const errors = validateTemplate(template, chosen.length, image !== null);
  if (imageError) errors.image = imageError;
  const plan = planNames(template, chosen, overrides);
  const rowErrors = validateRows(plan);
  // Lỗi của mẫu đã hiện ở form; chỉ lặp lại ở dòng nào có override riêng hoặc lỗi chỉ có ở dòng (vd. trùng symbol).
  const shownRowError = (id: string, field: 'name' | 'symbol') => {
    const msg = rowErrors[id]?.[field];
    if (!msg) return undefined;
    if (errors[field] && overrides[id]?.[field] === undefined) return undefined;
    return msg;
  };
  const hasErrors = Object.keys(errors).length > 0 || Object.keys(rowErrors).length > 0;
  const nameOf = (walletId: string) => wallets.find((w) => w.id === walletId)?.label ?? walletId.slice(0, 8);

  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const setOverride = (id: string, field: 'name' | 'symbol', value: string) =>
    setOverrides((o) => ({ ...o, [id]: { ...o[id], [field]: value } }));
  const clearOverride = (id: string) =>
    setOverrides((o) => { const { [id]: _drop, ...rest } = o; return rest; });

  function pickImage(file: File | null) {
    const problem = file ? validateImageFile(file) : null;
    setImageError(problem);
    setImage(file && !problem ? file : null);
    if (problem && fileRef.current) fileRef.current.value = '';
  }

  /** Làm mới tiến trình của lô: mỗi ví một lần tải, ghép lại theo id token. Phản hồi cũ bị bỏ. */
  const refresh = useCallback(async (tokens: PublicToken[]) => {
    if (tokens.length === 0 || isBatchSettled(tokens)) return;
    const seq = ++refreshSeq.current;
    const walletIds = [...new Set(tokens.map((t) => t.walletId))];
    const results = await Promise.allSettled(walletIds.map((id) => api.wallet(id)));
    if (!mounted.current || seq !== refreshSeq.current) return;
    const fresh = results.flatMap((r) => (r.status === 'fulfilled' ? r.value.tokens : []));
    if (fresh.length > 0) setBatch((prev) => mergeBatch(prev, fresh));
    const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
    if (failed) onErrorRef.current('Không làm mới được tiến trình mint: ' + errText(failed.reason)); // tối đa một lần mỗi lượt làm mới
  }, []);

  // Mỗi tín hiệu SSE: làm mới lô hiện có (nếu còn dòng chưa hoàn tất).
  const lastTick = useRef(liveTick);
  useEffect(() => {
    if (liveTick === lastTick.current) return;
    lastTick.current = liveTick;
    void refresh(batchRef.current);
  }, [liveTick, refresh]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (submitting.current || hasErrors || !image) return; // ref chặn bấm đúp trước khi state kịp cập nhật
    submitting.current = true;
    setBusy(true);
    try {
      const sent: Overrides = {};
      for (const id of chosen) if (overrides[id]) sent[id] = overrides[id];
      const tokens = await api.mint({ walletIds: chosen, template, overrides: sent }, image);
      refreshSeq.current++; // bỏ mọi phản hồi làm mới của lô cũ
      if (mounted.current) {
        setBatch(tokens);
        setSelected([]);
        setOverrides({});
        setImage(null);
        setImageError(null);
        if (fileRef.current) fileRef.current.value = '';
      }
      onMinted();
      void refresh(tokens); // các sự kiện SSE đến trước khi lô được ghi nhận sẽ không bị bỏ sót
    } catch (err) {
      onError(errText(err)); // form giữ nguyên để sửa rồi gửi lại
    } finally {
      submitting.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  async function retry(token: PublicToken) {
    if (retrying.includes(token.id)) return;
    setRetrying((r) => [...r, token.id]);
    try {
      await api.retryToken(token.id);
      void refresh(batchRef.current);
    } catch (err) {
      onError(errText(err));
    } finally {
      if (mounted.current) setRetrying((r) => r.filter((x) => x !== token.id));
    }
  }

  const allSelected = ready.length > 0 && chosen.length === ready.length;
  const summary = summarize(batch);
  const hintId = `${baseId}-hint`;
  const walletsErrId = `${baseId}-wallets-err`;

  return (
    <div className="stack">
      <form className="stack" onSubmit={submit} noValidate>
        <section className="card">
          <h2>1. Chọn ví</h2>
          {ready.length === 0 && <p className="muted">Chưa có ví nào ở trạng thái Sẵn sàng (cần có DUST). Tạo ví ở bên trái và đợi tới khi Sẵn sàng.</p>}
          <div className="row">
            {ready.length > 0 && (
              <button type="button" className="btn" onClick={() => setSelected(allSelected ? [] : ready.map((w) => w.id))}>
                {allSelected ? 'Bỏ chọn tất cả' : 'Chọn tất cả ví sẵn sàng'}
              </button>
            )}
            <span className="muted small" role="status">{chosen.length} ví được chọn</span>
          </div>
          <fieldset className="fieldset" aria-describedby={errors.wallets ? walletsErrId : undefined}>
            <legend>Ví sẽ mint (mỗi ví một token)</legend>
            <ul className="wallets pick">
              {ready.map((w) => (
                <li key={w.id}>
                  <label className="check">
                    <input type="checkbox" checked={chosen.includes(w.id)} onChange={() => toggle(w.id)} />
                    <span>{w.label}</span>
                    <StatusBadge status={w.status} />
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
          {errors.wallets && <p id={walletsErrId} className="field-error">{errors.wallets}</p>}
        </section>

        <section className="card">
          <h2>2. Thông tin token</h2>
          <p className="muted small">Mỗi ví tạo một token riêng. Dùng <code>{'{n}'}</code> trong tên/symbol để đánh số theo thứ tự ví (1, 2, 3…).</p>
          <div className="grid2">
            <Field label="Name" error={errors.name}>
              {(a) => <input {...a} value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />}
            </Field>
            <Field label="Symbol" error={errors.symbol} hint="1–12 chữ cái hoặc số, không dấu (kể cả số thứ tự).">
              {(a) => <input {...a} value={symbol} onChange={(e) => setSymbol(e.target.value)} autoComplete="off" />}
            </Field>
            <Field label="Decimals" error={errors.decimals}>
              {(a) => <input {...a} type="number" min={0} max={18} step={1} value={decimalsText} onChange={(e) => setDecimalsText(e.target.value)} />}
            </Field>
            <Field label="Số lượng mỗi ví (đơn vị token)" error={errors.amount}>
              {(a) => <input {...a} inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.trim())} autoComplete="off" />}
            </Field>
          </div>
          <Field label="Ảnh token (PNG, JPEG hoặc WEBP, tối đa 5 MB)" error={errors.image}>
            {(a) => <input {...a} ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => pickImage(e.target.files?.[0] ?? null)} />}
          </Field>
          {image && previewUrl && <img className="token-img" src={previewUrl} alt="Xem trước ảnh token" />}
        </section>

        <section className="card">
          <h2>3. Xem lại trước khi mint</h2>
          {chosen.length === 0 ? <p className="muted">Chọn ví để xem trước.</p> : (
            <div className="table-scroll">
              <table className="plan">
                <caption className="sr-only">Tên và symbol sẽ mint cho từng ví. Có thể sửa riêng từng dòng; giá trị sửa được dùng nguyên văn.</caption>
                <thead><tr><th scope="col">Ví</th><th scope="col">Name</th><th scope="col">Symbol</th><th scope="col"><span className="sr-only">Đặt lại</span></th></tr></thead>
                <tbody>
                  {plan.map((p) => {
                    const nErr = shownRowError(p.walletId, 'name');
                    const sErr = shownRowError(p.walletId, 'symbol');
                    const o = overrides[p.walletId];
                    const nId = `${baseId}-${p.walletId}-n`;
                    const sId = `${baseId}-${p.walletId}-s`;
                    return (
                      <tr key={p.walletId}>
                        <th scope="row" className="plan-wallet">{nameOf(p.walletId)}</th>
                        <td>
                          <input
                            aria-label={`Name của ${nameOf(p.walletId)}`}
                            aria-invalid={Boolean(nErr)}
                            aria-describedby={nErr ? `${nId}-err` : undefined}
                            value={o?.name ?? p.name}
                            onChange={(e) => setOverride(p.walletId, 'name', e.target.value)}
                          />
                          {nErr && <p id={`${nId}-err`} className="field-error">{nErr}</p>}
                        </td>
                        <td>
                          <input
                            aria-label={`Symbol của ${nameOf(p.walletId)}`}
                            aria-invalid={Boolean(sErr)}
                            aria-describedby={sErr ? `${sId}-err` : undefined}
                            value={o?.symbol ?? p.symbol}
                            onChange={(e) => setOverride(p.walletId, 'symbol', e.target.value)}
                          />
                          {sErr && <p id={`${sId}-err`} className="field-error">{sErr}</p>}
                        </td>
                        <td>
                          {o && <button type="button" className="btn tiny" onClick={() => clearOverride(p.walletId)} aria-label={`Về theo mẫu cho ${nameOf(p.walletId)}`}>Về mẫu</button>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <div className="row">
            <button type="submit" className="btn primary" disabled={busy || hasErrors} aria-describedby={hasErrors ? hintId : undefined}>
              {busy ? 'Đang gửi…' : `Mint cho ${chosen.length} ví`}
            </button>
            {hasErrors && <span id={hintId} className="muted small">Sửa các lỗi ở trên để bật nút Mint.</span>}
          </div>
        </section>
      </form>

      {batch.length > 0 && (
        <section className="card" aria-labelledby={`${baseId}-progress`}>
          <h2 id={`${baseId}-progress`}>Tiến trình mint</h2>
          <p className="small" role="status" aria-live="polite">{summaryText(summary)}</p>
          <div className="table-scroll">
            <table className="plan progress">
              <caption className="sr-only">Tiến trình theo từng ví và từng bước (Deploy contract rồi Mint)</caption>
              <thead><tr><th scope="col">Ví</th><th scope="col">Token</th><th scope="col">Các bước</th><th scope="col">Trạng thái</th></tr></thead>
              <tbody>
                {batch.map((t) => (
                  <tr key={t.id}>
                    <th scope="row" className="plan-wallet">{nameOf(t.walletId)}</th>
                    <td><span className="tok-name">{t.name}</span> <span className="mono muted">{t.symbol}</span></td>
                    <td>
                      <ol className="steps">
                        {stepStates(t).map((s) => (
                          <li key={s.key} className={`step ${s.state}`}>
                            <span className="glyph" aria-hidden="true">{STEP_GLYPH[s.state]}</span>
                            {s.label}
                            <span className="sr-only"> ({STEP_TEXT[s.state]})</span>
                          </li>
                        ))}
                      </ol>
                    </td>
                    <td>
                      <div className="status-cell">
                        <StatusBadge status={t.status} kind="token" />
                        {t.status === 'failed' && (
                          <>
                            {t.message && <p className="field-error">{t.message}</p>}
                            <button type="button" className="btn tiny" onClick={() => void retry(t)} disabled={retrying.includes(t.id)}>
                              {retrying.includes(t.id) ? 'Đang thử lại…' : 'Thử lại'}
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
