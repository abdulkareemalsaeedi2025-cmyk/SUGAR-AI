'use client';
import { useCallback, useEffect, useState } from 'react';
import {
  type PricingLot,
  type PricingMarket,
  type PricingSummary,
  priceToUsdPerMT,
  unitFor,
} from '../../lib/pricing';
import { useLang } from './LangContext';
import { pick } from '../../lib/i18n';

type Draft = {
  date: string;
  market: PricingMarket;
  contract: string;
  quantityMT: string;
  price: string;
  counterparty: string;
  reference: string;
  notes: string;
};

const todayISO = () => new Date().toISOString().slice(0, 10);
const emptyDraft = (): Draft => ({
  date: todayISO(),
  market: 'NY',
  contract: '',
  quantityMT: '',
  price: '',
  counterparty: '',
  reference: '',
  notes: '',
});

const toDraft = (l: PricingLot): Draft => ({
  date: l.date,
  market: l.market,
  contract: l.contract,
  quantityMT: String(l.quantityMT),
  price: String(l.price),
  counterparty: l.counterparty,
  reference: l.reference,
  notes: l.notes,
});

const num = (v: string): number => {
  const n = Number(String(v).replace(/[, ]/g, ''));
  return Number.isFinite(n) ? n : NaN;
};

const fmt = (n: number | null | undefined, d = 2): string =>
  n == null || !Number.isFinite(n) ? '—' : n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });

const fmtInt = (n: number | null | undefined): string =>
  n == null || !Number.isFinite(n) ? '—' : Math.round(n).toLocaleString('en-US');

export default function PricingLedger() {
  const { lang } = useLang();
  const [lots, setLots] = useState<PricingLot[]>([]);
  const [summary, setSummary] = useState<PricingSummary | null>(null);
  const [storage, setStorage] = useState<string>('…');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [editId, setEditId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Draft | null>(null);

  const load = useCallback(async () => {
    try {
      const j = await fetch('/api/pricing', { cache: 'no-store' }).then((r) => r.json());
      setLots(Array.isArray(j.lots) ? j.lots : []);
      setSummary(j.summary ?? null);
      setStorage(j.storage ?? 'unavailable');
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : pick(lang, 'فشل الاتصال', 'Connection failed'));
    } finally {
      setLoading(false);
    }
  }, [lang]);

  useEffect(() => {
    load();
  }, [load]);

  const flash = (msg: string) => {
    setOkMsg(msg);
    setTimeout(() => setOkMsg(null), 2600);
  };

  const validate = (d: Draft): string | null => {
    const q = num(d.quantityMT);
    const p = num(d.price);
    if (!Number.isFinite(q) || q <= 0) return pick(lang, 'الكمية يجب أن تكون رقماً أكبر من صفر.', 'Quantity must be a number greater than zero.');
    if (!Number.isFinite(p) || p < 0) return pick(lang, 'السعر غير صالح.', 'Invalid price.');
    return null;
  };

  const create = async () => {
    const bad = validate(draft);
    if (bad) return setError(bad);
    setBusy(true);
    setError(null);
    try {
      const r = await fetch('/api/pricing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...draft,
          quantityMT: num(draft.quantityMT),
          price: num(draft.price),
        }),
      });
      const j = await r.json();
      if (!r.ok || j.ok === false) throw new Error(j.error || `HTTP ${r.status}`);
      setDraft(emptyDraft());
      flash(pick(lang, 'أُضيفت الدفعة.', 'Lot added.'));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : pick(lang, 'فشل الحفظ', 'Save failed'));
    } finally {
      setBusy(false);
    }
  };

  const startEdit = (l: PricingLot) => {
    setEditId(l.id);
    setEditDraft(toDraft(l));
    setError(null);
  };

  const cancelEdit = () => {
    setEditId(null);
    setEditDraft(null);
  };

  const saveEdit = async () => {
    if (!editId || !editDraft) return;
    const bad = validate(editDraft);
    if (bad) return setError(bad);
    setBusy(true);
    setError(null);
    try {
      const r = await fetch('/api/pricing', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...editDraft,
          id: editId,
          quantityMT: num(editDraft.quantityMT),
          price: num(editDraft.price),
        }),
      });
      const j = await r.json();
      if (!r.ok || j.ok === false) throw new Error(j.error || `HTTP ${r.status}`);
      cancelEdit();
      flash(pick(lang, 'حُدّثت الدفعة.', 'Lot updated.'));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : pick(lang, 'فشل التحديث', 'Update failed'));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/pricing?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      const j = await r.json();
      if (!r.ok || j.ok === false) throw new Error(j.error || `HTTP ${r.status}`);
      flash(pick(lang, 'حُذفت الدفعة.', 'Lot deleted.'));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : pick(lang, 'فشل الحذف', 'Delete failed'));
    } finally {
      setBusy(false);
    }
  };

  const onReadOnly = storage !== 'server' && !loading;

  const q = summary;
  const dir = lang === 'ar' ? 'rtl' : 'ltr';
  const marketName = (m: PricingMarket) => (m === 'NY' ? pick(lang, 'نيويورك No.11', 'New York No.11') : pick(lang, 'لندن No.5', 'London No.5'));

  return (
    <section className="card pricing" dir={dir}>
      <div className="cardhead">
        <div>
          <span className="kicker">PRICING LEDGER</span>
          <h2>{pick(lang, 'دفتر التسعير · الأسعار المثبّتة', 'Pricing Ledger · Fixed Prices')}</h2>
        </div>
        <div className="pricing__badges">
          <span className={`pricing__badge pricing__badge--${storage}`}>
            {storage === 'server'
              ? pick(lang, 'محفوظ على الخادم', 'Saved on server')
              : storage === 'memory'
                ? pick(lang, 'ذاكرة مؤقتة', 'In-memory')
                : pick(lang, 'غير متاح', 'Unavailable')}
          </span>
        </div>
      </div>

      <div className="pricing__summary">
        <div className="pricing__stat">
          <span>{pick(lang, 'عدد الدفعات', 'Lots')}</span>
          <b>{q?.count ?? 0}</b>
        </div>
        <div className="pricing__stat">
          <span>{pick(lang, 'إجمالي الكمية', 'Total quantity')}</span>
          <b>{fmtInt(q?.totalMT)}<small> MT</small></b>
        </div>
        <div className="pricing__stat">
          <span>{pick(lang, 'متوسط موزون', 'Weighted avg')}</span>
          <b>{fmt(q?.avgUsdPerMT)}<small> US$/MT</small></b>
        </div>
        <div className="pricing__stat">
          <span>{pick(lang, 'القيمة الإسمية', 'Notional value')}</span>
          <b>{fmtInt(q?.notionalUsd)}<small> US$</small></b>
        </div>
      </div>

      {onReadOnly && (
        <div className="pricing__warn">
          {pick(lang, 'التخزين الدائم غير متاح على هذا الاستضافة — لن تُحفظ الدفعات بعد إعادة التشغيل.', 'Persistent storage is unavailable on this host — lots will not survive a restart.')}
        </div>
      )}

      {/* add row */}
      <div className="pricing__form">
        <label>
          <span>{pick(lang, 'التاريخ', 'Date')}</span>
          <input type="date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} />
        </label>
        <label>
          <span>{pick(lang, 'السوق', 'Market')}</span>
          <select value={draft.market} onChange={(e) => setDraft({ ...draft, market: e.target.value as PricingMarket })}>
            <option value="NY">{pick(lang, 'نيويورك No.11 (خام)', 'New York No.11 (raw)')}</option>
            <option value="London">{pick(lang, 'لندن No.5 (أبيض)', 'London No.5 (white)')}</option>
          </select>
        </label>
        <label>
          <span>{pick(lang, 'العقد', 'Contract')}</span>
          <input type="text" placeholder="SBH27" value={draft.contract} onChange={(e) => setDraft({ ...draft, contract: e.target.value })} />
        </label>
        <label>
          <span>{pick(lang, 'الكمية (MT)', 'Quantity (MT)')}</span>
          <input type="number" min="0" step="any" value={draft.quantityMT} onChange={(e) => setDraft({ ...draft, quantityMT: e.target.value })} />
        </label>
        <label>
          <span>{pick(lang, 'السعر', 'Price')} ({unitFor(draft.market)})</span>
          <input type="number" min="0" step="any" value={draft.price} onChange={(e) => setDraft({ ...draft, price: e.target.value })} />
        </label>
        <label>
          <span>{pick(lang, 'الطرف المقابل', 'Counterparty')}</span>
          <input type="text" value={draft.counterparty} onChange={(e) => setDraft({ ...draft, counterparty: e.target.value })} />
        </label>
        <label>
          <span>{pick(lang, 'المرجع', 'Reference')}</span>
          <input type="text" value={draft.reference} onChange={(e) => setDraft({ ...draft, reference: e.target.value })} />
        </label>
        <label className="pricing__form-notes">
          <span>{pick(lang, 'ملاحظات', 'Notes')}</span>
          <input type="text" value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />
        </label>
        <button type="button" className="pricing__add" onClick={create} disabled={busy || onReadOnly}>
          + {pick(lang, 'إضافة دفعة', 'Add lot')}
        </button>
      </div>

      {/* vessel pricing table moved to its own section: components/VesselPricingTable.tsx */}

      {error && <div className="pricing__err">⚠ {error}</div>}
      {okMsg && <div className="pricing__ok">✓ {okMsg}</div>}

      <div className="pricing__tablewrap">
        <table className="pricing__table">
          <thead>
            <tr>
              <th>{pick(lang, 'التاريخ', 'Date')}</th>
              <th>{pick(lang, 'السوق', 'Market')}</th>
              <th>{pick(lang, 'العقد', 'Contract')}</th>
              <th>{pick(lang, 'الكمية MT', 'Qty MT')}</th>
              <th>{pick(lang, 'السعر', 'Price')}</th>
              <th>{pick(lang, 'الوحدة', 'Unit')}</th>
              <th>{pick(lang, 'القيمة US$', 'Value US$')}</th>
              <th>{pick(lang, 'الطرف', 'Party')}</th>
              <th>{pick(lang, 'مرجع', 'Ref')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={10} className="pricing__empty">{pick(lang, 'جارِ التحميل…', 'Loading…')}</td></tr>
            )}
            {!loading && !lots.length && (
              <tr><td colSpan={10} className="pricing__empty">{pick(lang, 'لا توجد دفعات مسعّرة بعد — أضف أول دفعة أعلاه.', 'No priced lots yet — add the first one above.')}</td></tr>
            )}
            {lots.map((l) => {
              const editing = editId === l.id && editDraft;
              if (editing && editDraft) {
                return (
                  <tr key={l.id} className="pricing__row pricing__row--edit">
                    <td><input type="date" value={editDraft.date} onChange={(e) => setEditDraft({ ...editDraft, date: e.target.value })} /></td>
                    <td>
                      <select value={editDraft.market} onChange={(e) => setEditDraft({ ...editDraft, market: e.target.value as PricingMarket })}>
                        <option value="NY">NY</option>
                        <option value="London">London</option>
                      </select>
                    </td>
                    <td><input type="text" value={editDraft.contract} onChange={(e) => setEditDraft({ ...editDraft, contract: e.target.value })} /></td>
                    <td><input type="number" step="any" value={editDraft.quantityMT} onChange={(e) => setEditDraft({ ...editDraft, quantityMT: e.target.value })} /></td>
                    <td><input type="number" step="any" value={editDraft.price} onChange={(e) => setEditDraft({ ...editDraft, price: e.target.value })} /></td>
                    <td>{unitFor(editDraft.market)}</td>
                    <td>—</td>
                    <td><input type="text" value={editDraft.counterparty} onChange={(e) => setEditDraft({ ...editDraft, counterparty: e.target.value })} /></td>
                    <td><input type="text" value={editDraft.reference} onChange={(e) => setEditDraft({ ...editDraft, reference: e.target.value })} /></td>
                    <td className="pricing__actions">
                      <button type="button" onClick={saveEdit} disabled={busy}>{pick(lang, 'حفظ', 'Save')}</button>
                      <button type="button" onClick={cancelEdit} disabled={busy}>{pick(lang, 'إلغاء', 'Cancel')}</button>
                    </td>
                  </tr>
                );
              }
              const value = priceToUsdPerMT(l.market, l.price) * l.quantityMT;
              return (
                <tr key={l.id} className="pricing__row">
                  <td>{l.date}</td>
                  <td>{marketName(l.market)}</td>
                  <td className="pricing__sym">{l.contract || '—'}</td>
                  <td>{fmt(l.quantityMT, 0)}</td>
                  <td>{fmt(l.price, l.market === 'NY' ? 2 : 2)}</td>
                  <td>{unitFor(l.market)}</td>
                  <td>{fmtInt(value)}</td>
                  <td>{l.counterparty || '—'}</td>
                  <td>{l.reference || '—'}</td>
                  <td className="pricing__actions">
                    <button type="button" onClick={() => startEdit(l)} disabled={busy}>{pick(lang, 'تعديل', 'Edit')}</button>
                    <button type="button" className="danger" onClick={() => remove(l.id)} disabled={busy}>{pick(lang, 'حذف', 'Delete')}</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="pricing__foot">
        {pick(
          lang,
          'الأسعار مثبّتة يدوياً من قبل المستخدم (غير مسحوبة من السوق آلياً). القيمة تُحسب بتحويل الخام: 1 ¢/lb = 22.0462262 US$/MT. لا تُعد توصية استثمارية ملزمة.',
          'Prices are fixed manually by the user (not auto-pulled from the market). Value is computed by converting raw: 1 ¢/lb = 22.0462262 US$/MT. Not a binding investment recommendation.',
        )}
      </p>
    </section>
  );
}